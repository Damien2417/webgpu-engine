import init, { World } from '../../engine-core/pkg/engine_core.js';

await init();

// ── Canvas + WebGPU ───────────────────────────────────────────────────────
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
if (!canvas) throw new Error('Canvas #game-canvas introuvable');

canvas.width  = window.innerWidth;
canvas.height = window.innerHeight;

let world: World;
try {
  world = await World.new(canvas);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  document.body.innerHTML = `<pre style="color:red;padding:20px">Erreur WebGPU:\n${msg}</pre>`;
  throw err;
}

// ── Constantes input ──────────────────────────────────────────────────────
const KEY_W     = 1 << 0;
const KEY_S     = 1 << 1;
const KEY_A     = 1 << 2;
const KEY_D     = 1 << 3;
const KEY_SPACE = 1 << 4;

// ── Générateur de texture damier ──────────────────────────────────────────
function makeChecker(
  w: World,
  size: number,
  c1: [number, number, number],
  c2: [number, number, number]
): number {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = (x + y) % 2 === 0 ? c1 : c2;
      const i = (y * size + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return w.upload_texture(size, size, data);
}

const floorTex = makeChecker(world, 8, [180, 180, 180], [60, 60, 60]);
const boxTex   = makeChecker(world, 4, [220, 120,  60], [140, 60, 20]);

// ── Scène ─────────────────────────────────────────────────────────────────

// Sol invisible (collider seul)
const floor = world.create_entity();
world.add_transform(floor, 0, -0.5, 0);
world.add_rigid_body(floor, true);
world.add_collider_aabb(floor, 10, 0.5, 10);

// Sol visible (cube plat décoratif, pas de physique)
const floorMesh = world.create_entity();
world.add_transform(floorMesh, 0, -0.5, 0);
world.set_scale(floorMesh, 20, 1, 20);
world.add_mesh_renderer(floorMesh);
world.add_material(floorMesh, floorTex);

// Cubes obstacles statiques
const obstacles: [number, number, number][] = [
  [ 3, 0.5,  3], [-3, 0.5,  3],
  [ 3, 0.5, -3], [-3, 0.5, -3],
  [ 6, 0.5,  0], [-6, 0.5,  0],
  [ 0, 0.5,  6], [ 0, 0.5, -6],
];
for (const [x, y, z] of obstacles) {
  const box = world.create_entity();
  world.add_transform(box, x, y, z);
  world.add_mesh_renderer(box);
  world.add_material(box, boxTex);
  world.add_rigid_body(box, true);
  world.add_collider_aabb(box, 0.5, 0.5, 0.5);
}

// Joueur (dynamique, sans MeshRenderer — vue FPS)
const player = world.create_entity();
world.add_transform(player, 0, 2, 0);   // démarre en hauteur, tombe sur le sol
world.add_rigid_body(player, false);
world.add_collider_aabb(player, 0.3, 0.9, 0.3);
world.set_player(player);

// ── Éclairage ──────────────────────────────────────────────────────────────

// Lumière directionnelle (soleil oblique, légèrement chaud)
world.add_directional_light(-0.5, -1.0, -0.3,  1.0, 0.95, 0.8,  1.2);

// Point light cyan (coin positif)
const lamp1 = world.create_entity();
world.add_transform(lamp1, 4, 2.5, 4);
world.add_point_light(lamp1, 0.3, 0.8, 1.0, 10.0);

// Point light orange (coin négatif)
const lamp2 = world.create_entity();
world.add_transform(lamp2, -4, 2.5, -4);
world.add_point_light(lamp2, 1.0, 0.4, 0.2, 10.0);

// ── Input ─────────────────────────────────────────────────────────────────
let keysMask   = 0;
let mouseDxAcc = 0;
let mouseDyAcc = 0;

document.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW':  keysMask |= KEY_W;     break;
    case 'KeyS':  keysMask |= KEY_S;     break;
    case 'KeyA':  keysMask |= KEY_A;     break;
    case 'KeyD':  keysMask |= KEY_D;     break;
    case 'Space': keysMask |= KEY_SPACE; e.preventDefault(); break;
  }
});

document.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW':  keysMask &= ~KEY_W;     break;
    case 'KeyS':  keysMask &= ~KEY_S;     break;
    case 'KeyA':  keysMask &= ~KEY_A;     break;
    case 'KeyD':  keysMask &= ~KEY_D;     break;
    case 'Space': keysMask &= ~KEY_SPACE; break;
  }
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) {
    mouseDxAcc += e.movementX;
    mouseDyAcc += e.movementY;
  }
});

// Pointer Lock au clic sur le canvas
canvas.addEventListener('click', () => canvas.requestPointerLock());

// Overlay "Cliquer pour jouer"
const overlay = document.createElement('div');
overlay.textContent = 'Cliquer pour jouer — WASD + Souris + ESPACE (saut)';
overlay.style.cssText = [
  'position:fixed', 'inset:0', 'display:flex',
  'align-items:center', 'justify-content:center',
  'color:white', 'font:bold 20px sans-serif',
  'background:rgba(0,0,0,.55)', 'pointer-events:none',
].join(';');
document.body.appendChild(overlay);

document.addEventListener('pointerlockchange', () => {
  overlay.style.display = document.pointerLockElement === canvas ? 'none' : 'flex';
});

document.addEventListener('pointerlockerror', () => {
  overlay.textContent = 'Pointer Lock refusé — réessayez ou vérifiez les permissions du navigateur.';
  overlay.style.display = 'flex';
});

// ── Boucle de jeu ─────────────────────────────────────────────────────────
let lastTime = performance.now();

function loop(): void {
  const now   = performance.now();
  const delta = now - lastTime;
  lastTime    = now;

  world.set_input(keysMask, mouseDxAcc, mouseDyAcc);
  mouseDxAcc = 0;
  mouseDyAcc = 0;

  world.update(delta);
  world.render_frame(delta);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
