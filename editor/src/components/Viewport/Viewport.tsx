import { useEffect, useRef, useState } from 'react';
import { bridge } from '../../engine/engineBridge';
import { useSceneStore } from '../../store/sceneStore';
import GizmoOverlay from './GizmoOverlay';

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
  const refresh = useSceneStore(s => s.refresh);

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

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%', position: 'relative', cursor: 'grab' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      <GizmoOverlay width={dims.w} height={dims.h} />
    </div>
  );
}
