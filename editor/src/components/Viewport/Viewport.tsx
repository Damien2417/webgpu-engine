import { useEffect, useRef, useState } from 'react';
import { bridge } from '../../engine/engineBridge';
import { useEditorStore } from '../../store/editorStore';
import { useSceneStore } from '../../store/sceneStore';
import GizmoOverlay from './GizmoOverlay';
import { initScripts, tickScripts } from '../../engine/scriptRunner';

// Orbital camera state kept at module level across renders.
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const refresh = useSceneStore(s => s.refresh);
  const isPlaying = useEditorStore(s => s.isPlaying);

  // Init WASM + render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const parent = canvas.parentElement!;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas.width = w;
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

  // Mouse drag = orbit, wheel = zoom
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (e: MouseEvent) => { dragging = true; lastX = e.clientX; lastY = e.clientY; };
    const onUp = () => { dragging = false; };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      orbit.azimuth -= (e.clientX - lastX) * 0.005;
      orbit.elevation = Math.max(-1.5, Math.min(1.5, orbit.elevation + (e.clientY - lastY) * 0.005));
      lastX = e.clientX;
      lastY = e.clientY;
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

  // F-to-frame: focus camera on selected entity
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        const sel = useEditorStore.getState().selectedId;
        if (sel !== null) {
          const t = bridge.getTransform(sel);
          const [px, py, pz] = t.position;
          bridge.setCamera(px + 3, py + 3, pz + 3, px, py, pz);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // FPS input effect, only in game mode.
  useEffect(() => {
    if (!isPlaying) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Mouse delta accumulation between frames.
    let mouseDx = 0;
    let mouseDy = 0;
    let keys = 0;

    const onMouseMove = (e: MouseEvent) => {
      mouseDx += e.movementX;
      mouseDy += e.movementY;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyW') keys |= (1 << 0);
      if (e.code === 'KeyS') keys |= (1 << 1);
      if (e.code === 'KeyA') keys |= (1 << 2);
      if (e.code === 'KeyD') keys |= (1 << 3);
      if (e.code === 'Space') { keys |= (1 << 4); e.preventDefault(); }
      if (e.code === 'Escape') { document.exitPointerLock(); }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyW') keys &= ~(1 << 0);
      if (e.code === 'KeyS') keys &= ~(1 << 1);
      if (e.code === 'KeyA') keys &= ~(1 << 2);
      if (e.code === 'KeyD') keys &= ~(1 << 3);
      if (e.code === 'Space') keys &= ~(1 << 4);
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
      bridge.setInput(0, 0, 0);
      document.exitPointerLock();
    };
  }, [isPlaying, refresh]);

  // Restart editor loop when leaving game mode.
  useEffect(() => {
    if (!isPlaying) {
      bridge.stopLoop();
      bridge.startLoop(refresh);
    }
  }, [isPlaying, refresh]);

  return (
    <div ref={wrapRef} className="viewport-root" style={{ cursor: isPlaying ? 'none' : 'grab' }}>
      <canvas ref={canvasRef} className="viewport-canvas" />
      <div className="viewport-grid" />
      {!isPlaying && <GizmoOverlay width={dims.w} height={dims.h} />}
      {isPlaying && <div className="viewport-crosshair">+</div>}
      {isPlaying && <div className="viewport-hint">Click to capture mouse - Esc to release</div>}
    </div>
  );
}
