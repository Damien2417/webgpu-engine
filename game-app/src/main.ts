import init, { World } from '../../engine-core/pkg/engine_core.js';

await init();

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
if (!canvas) throw new Error('Canvas #game-canvas introuvable');

let world: World;
try {
  world = await World.new(canvas);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  document.body.innerHTML =
    `<pre style="color:red;padding:20px">Erreur WebGPU:\n${msg}</pre>`;
  throw err;
}

// ── Générer une texture damier 8×8 programmatiquement ────────────────────────
function createCheckerTexture(world: World, size: number): number {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const isLight = (x + y) % 2 === 0;
      const i = (y * size + x) * 4;
      data[i]     = isLight ? 255 : 40;  // R
      data[i + 1] = isLight ? 255 : 40;  // G
      data[i + 2] = isLight ? 255 : 40;  // B
      data[i + 3] = 255;                 // A
    }
  }
  return world.upload_texture(size, size, data);
}

// ── Scène ─────────────────────────────────────────────────────────────────────
const checkerId = createCheckerTexture(world, 8);

const cube = world.create_entity();
world.add_transform(cube, 0, 0, 0);
world.add_mesh_renderer(cube);
world.add_material(cube, checkerId);
world.set_camera(3, 2, 5,  0, 0, 0);

let angle    = 0;
let lastTime = performance.now();

function loop(): void {
  const now   = performance.now();
  const delta = now - lastTime;
  lastTime    = now;

  angle += delta * 0.05;
  world.set_rotation(cube, 15, angle, 0);
  world.render_frame(delta);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
