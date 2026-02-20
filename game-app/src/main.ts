import init, { Engine } from '../../engine-core/pkg/engine_core.js';

await init();

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
if (!canvas) throw new Error('Canvas #game-canvas introuvable');

let engine: Engine;
try {
  engine = await Engine.init(canvas);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  document.body.innerHTML =
    `<pre style="color:red;padding:20px">Erreur WebGPU:\n${msg}</pre>`;
  throw err;
}

// Créer un cube et positionner la caméra
const cubeId = engine.create_cube();
engine.set_camera(3, 2, 5,   0, 0, 0);

let angle    = 0;
let lastTime = performance.now();

function loop(): void {
  const now   = performance.now();
  const delta = now - lastTime;
  lastTime    = now;

  // Faire tourner le cube sur l'axe Y en fonction du delta-time
  angle += delta * 0.05; // ~18°/sec

  engine.set_rotation(cubeId, 15, angle, 0);
  engine.render_frame(delta);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
