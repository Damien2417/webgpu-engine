import init, { Engine } from '../../engine-core/pkg/engine_core.js';

// 1. Charger et initialiser le module WASM
await init();

// 2. Récupérer le canvas du DOM
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error('Canvas #game-canvas introuvable dans le DOM');
}

// 3. Initialiser le moteur GPU depuis Rust (async → JS Promise)
let engine: Engine;
try {
  engine = await Engine.init(canvas);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  document.body.innerHTML = `<pre style="color:red;padding:20px">Erreur d'initialisation WebGPU:\n${msg}</pre>`;
  throw err;
}

// 4. Boucle de rendu pilotée par TypeScript
function loop(): void {
  engine.render_frame();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
