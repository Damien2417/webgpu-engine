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

// Créer une entité cube via l'ECS
const cube = world.create_entity();
world.add_transform(cube, 0, 0, 0);
world.add_mesh_renderer(cube);
world.set_camera(3, 2, 5,  0, 0, 0);

let angle    = 0;
let lastTime = performance.now();

function loop(): void {
  const now   = performance.now();
  const delta = now - lastTime;
  lastTime    = now;

  angle += delta * 0.05; // ~18°/sec

  world.set_rotation(cube, 15, angle, 0);
  world.render_frame(delta);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
