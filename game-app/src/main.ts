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

// ── Upload textures et enregistrement dans le registre ───────────────────
const floorTexId = makeChecker(world, 8, [180, 180, 180], [60, 60, 60]);
const boxTexId   = makeChecker(world, 4, [220, 120,  60], [140, 60, 20]);

world.register_texture('floor_checker', floorTexId);
world.register_texture('box_checker',   boxTexId);

// ── Joueur persistant (créé une seule fois, survit aux load_scene) ────────
const player = world.create_entity();
world.add_transform(player, 0, 2, 0);
world.add_rigid_body(player, false);
world.add_collider_aabb(player, 0.3, 0.9, 0.3);
world.set_player(player);
world.set_persistent(player, true);

// ── Chargement de scène ───────────────────────────────────────────────────
let currentLevel = 1;

async function loadLevel(n: number): Promise<void> {
  const json = await fetch(`/scenes/level${n}.json`).then(r => r.text());
  world.load_scene(json);
  currentLevel = n;
  console.log(`[Scene] level${n} chargé`);
}

await loadLevel(1);

// ── Input ─────────────────────────────────────────────────────────────────
let keysMask   = 0;
let mouseDxAcc = 0;
let mouseDyAcc = 0;

document.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW':     keysMask |= KEY_W;     break;
    case 'KeyS':     keysMask |= KEY_S;     break;
    case 'KeyA':     keysMask |= KEY_A;     break;
    case 'KeyD':     keysMask |= KEY_D;     break;
    case 'Space':    keysMask |= KEY_SPACE; e.preventDefault(); break;
    // Touche N = niveau suivant (switch de scène in-game)
    case 'KeyN':     loadLevel(currentLevel === 1 ? 2 : 1); break;
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

canvas.addEventListener('click', () => canvas.requestPointerLock());

// Overlay
const overlay = document.createElement('div');
overlay.textContent = 'Cliquer pour jouer — WASD + Souris + ESPACE (saut) + N (changer de scène)';
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
