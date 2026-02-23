import { useEffect, useRef, useState } from 'react';
import { bridge } from '../../engine/engineBridge';
import { useEditorStore } from '../../store/editorStore';
import { useSceneStore } from '../../store/sceneStore';
import GizmoOverlay from './GizmoOverlay';
import { initScripts, tickScripts } from '../../engine/scriptRunner';

// Caméra orbitale (state module-level pour persister entre re-renders)
const orbit = { distance: 8, azimuth: 0.5, elevation: 0.4, tx: 0, ty: 0, tz: 0 };

function orbitToEye() {
  const { distance, azimuth, elevation, tx, ty, tz } = orbit;
  return {
    x: tx + distance * Math.cos(elevation) * Math.sin(azimuth),
    y: ty + distance * Math.sin(elevation),
    z: tz + distance * Math.cos(elevation) * Math.cos(azimuth),
  };
}

export default function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef   = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const refresh   = useSceneStore(s => s.refresh);
  const isPlaying = useEditorStore(s => s.isPlaying);

  // Init WASM + render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const parent = canvas.parentElement!;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas.width  = w;
      canvas.height = h;
      setDims({ w, h });
    };
    resize();

    let started = false;
    (async () => {
      if (started) return;
      started = true;
      await bridge.initialize(canvas);
      applyCamera();
      refresh();
      bridge.startLoop(refresh);
    })();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);
    return () => { bridge.stopLoop(); ro.disconnect(); };
  }, []);

  function applyCamera() {
    const e = orbitToEye();
    bridge.setCamera(e.x, e.y, e.z, orbit.tx, orbit.ty, orbit.tz);
  }

  // Drag souris = orbite, scroll = zoom
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let dragging = false;
    let lastX = 0, lastY = 0;

    const onDown  = (e: MouseEvent) => { dragging = true; lastX = e.clientX; lastY = e.clientY; };
    const onUp    = () => { dragging = false; };
    const onMove  = (e: MouseEvent) => {
      if (!dragging) return;
      orbit.azimuth   -= (e.clientX - lastX) * 0.005;
      orbit.elevation  = Math.max(-1.5, Math.min(1.5, orbit.elevation + (e.clientY - lastY) * 0.005));
      lastX = e.clientX; lastY = e.clientY;
      applyCamera();
    };
    const onWheel = (e: WheelEvent) => {
      orbit.distance = Math.max(1, orbit.distance + e.deltaY * 0.01);
      applyCamera();
    };

    el.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('mousemove', onMove);
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('mousemove', onMove);
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  // FPS input effect — active uniquement en mode jeu
  useEffect(() => {
    if (!isPlaying) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Accumulation delta souris entre frames
    let mouseDx = 0, mouseDy = 0;
    let keys    = 0;

    const onMouseMove = (e: MouseEvent) => {
      mouseDx += e.movementX;
      mouseDy += e.movementY;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyW')     keys |=  (1 << 0);
      if (e.code === 'KeyS')     keys |=  (1 << 1);
      if (e.code === 'KeyA')     keys |=  (1 << 2);
      if (e.code === 'KeyD')     keys |=  (1 << 3);
      if (e.code === 'Space')  { keys |=  (1 << 4); e.preventDefault(); }
      if (e.code === 'Escape') { document.exitPointerLock(); } // releases cursor but keeps play mode running
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyW')   keys &= ~(1 << 0);
      if (e.code === 'KeyS')   keys &= ~(1 << 1);
      if (e.code === 'KeyA')   keys &= ~(1 << 2);
      if (e.code === 'KeyD')   keys &= ~(1 << 3);
      if (e.code === 'Space')  keys &= ~(1 << 4);
    };

    const onFrame = () => {
      bridge.setInput(keys, mouseDx, mouseDy);
      mouseDx = 0;
      mouseDy = 0;
    };

    const onClick = () => canvas.requestPointerLock();

    canvas.addEventListener('click', onClick);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    // Start game loop (update + render) instead of render-only loop
    bridge.stopLoop();
    initScripts();
    bridge.startGameLoop((_deltaMs) => {
      tickScripts(_deltaMs);
      onFrame();
      refresh();
    });

    return () => {
      canvas.removeEventListener('click', onClick);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      bridge.stopLoop();
      bridge.setInput(0, 0, 0); // reset input
      document.exitPointerLock();
    };
  }, [isPlaying, refresh]);

  // Redémarre l'editor loop quand on quitte le mode jeu
  useEffect(() => {
    // Note: this effect runs after the FPS effect above (React runs effects in declaration order).
    // On play→stop: FPS cleanup calls stopLoop, then this restarts the editor loop.
    // On mount: fires before bridge.initialize completes — startLoop is a safe no-op (world is null).
    if (!isPlaying) {
      bridge.stopLoop();
      bridge.startLoop(refresh);
    }
  }, [isPlaying, refresh]);

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%', position: 'relative', cursor: isPlaying ? 'none' : 'grab' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      {!isPlaying && <GizmoOverlay width={dims.w} height={dims.h} />}
      {isPlaying && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none', color: 'white', fontSize: 18, fontWeight: 'bold',
          textShadow: '0 0 3px black',
          userSelect: 'none',
        }}>
          +
        </div>
      )}
      {isPlaying && (
        <div style={{
          position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
          color: 'rgba(255,255,255,0.6)', fontSize: 10, pointerEvents: 'none',
          textShadow: '0 0 3px black',
        }}>
          Clic pour capturer la souris · Echap pour libérer
        </div>
      )}
    </div>
  );
}
