import init, { Engine } from '../../engine-core/pkg/engine_core.js';

// 1. Charger et initialiser le module WASM (fetch + instantiate le .wasm)
await init();

// 2. Récupérer le canvas du DOM
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error('Canvas #game-canvas introuvable dans le DOM');
}

// 3. Initialiser le moteur GPU depuis Rust (async → JS Promise)
const engine: Engine = await Engine.init(canvas);

// 4. Boucle de rendu pilotée par TypeScript
function loop(): void {
  engine.render_frame();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
