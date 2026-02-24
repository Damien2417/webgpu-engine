import { useEffect, useRef, useState } from 'react';
import { bridge } from '../../engine/engineBridge';
import { useEditorStore } from '../../store/editorStore';
import { useSceneStore } from '../../store/sceneStore';
import { useAssetStore } from '../../store/assetStore';
import { useCustomMeshStore } from '../../store/customMeshStore';
import GizmoOverlay from './GizmoOverlay';
import { initScripts, tickScripts } from '../../engine/scriptRunner';
import { tickParticles, clearParticles } from '../../engine/particleSystem';
import { hydrateAssetLibraryFromBackend, restoreSessionFromLocalStorage } from '../../engine/sessionPersistence';

const freeCam = { pos: [6, 4, 6] as [number, number, number], yaw: -Math.PI / 4, pitch: -0.35 };

function getForward(): [number, number, number] {
  const cp = Math.cos(freeCam.pitch);
  return [
    cp * Math.sin(freeCam.yaw),
    Math.sin(freeCam.pitch),
    -cp * Math.cos(freeCam.yaw),
  ];
}

export default function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [fps, setFps] = useState(0);
  const fpsRef = useRef({ frames: 0, lastSampleMs: performance.now() });
  const refresh = useSceneStore(s => s.refresh);
  const isPlaying = useEditorStore(s => s.isPlaying);

  const trackFps = () => {
    const now = performance.now();
    fpsRef.current.frames += 1;
    const elapsed = now - fpsRef.current.lastSampleMs;
    if (elapsed >= 500) {
      const value = Math.round((fpsRef.current.frames * 1000) / elapsed);
      setFps(value);
      fpsRef.current.frames = 0;
      fpsRef.current.lastSampleMs = now;
    }
  };

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
      const restored = await restoreSessionFromLocalStorage();
      const hasAssets = useAssetStore.getState().assets.length > 0;
      const hasCustomMeshes = useCustomMeshStore.getState().meshes.length > 0;
      if (!restored || (!hasAssets && !hasCustomMeshes)) {
        await hydrateAssetLibraryFromBackend();
      }
      refresh();
      bridge.startLoop(() => {
        refresh();
        trackFps();
      });
    })();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);
    return () => { bridge.stopLoop(); ro.disconnect(); };
  }, []);

  function applyCamera() {
    const f = getForward();
    bridge.setCamera(
      freeCam.pos[0], freeCam.pos[1], freeCam.pos[2],
      freeCam.pos[0] + f[0], freeCam.pos[1] + f[1], freeCam.pos[2] + f[2],
    );
  }

  // Free camera controls (editor mode): RMB look + WASD move + Q/E up/down
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let looking = false;
    let lastX = 0;
    let lastY = 0;
    const keys = new Set<string>();
    let raf: number | null = null;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      if (!isPlaying && keys.size > 0) {
        const f = getForward();
        const right: [number, number, number] = [Math.cos(freeCam.yaw), 0, Math.sin(freeCam.yaw)];
        let vx = 0;
        let vy = 0;
        let vz = 0;
        const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 12 : 6;

        if (keys.has('KeyW')) { vx += f[0]; vy += f[1]; vz += f[2]; }
        if (keys.has('KeyS')) { vx -= f[0]; vy -= f[1]; vz -= f[2]; }
        if (keys.has('KeyA')) { vx -= right[0]; vz -= right[2]; }
        if (keys.has('KeyD')) { vx += right[0]; vz += right[2]; }
        if (keys.has('KeyE')) vy += 1;
        if (keys.has('KeyQ')) vy -= 1;

        const len = Math.hypot(vx, vy, vz);
        if (len > 1e-6) {
          freeCam.pos[0] += (vx / len) * speed * dt;
          freeCam.pos[1] += (vy / len) * speed * dt;
          freeCam.pos[2] += (vz / len) * speed * dt;
          applyCamera();
        }
      }
      raf = requestAnimationFrame(tick);
    };

    const onDown = (e: MouseEvent) => {
      if (e.button === 2) {
        looking = true;
        lastX = e.clientX;
        lastY = e.clientY;
        e.preventDefault();
      }
    };
    const onUp = (e: MouseEvent) => {
      if (e.button === 2) looking = false;
    };
    const onMove = (e: MouseEvent) => {
      if (!looking || isPlaying) return;
      freeCam.yaw -= (e.clientX - lastX) * 0.004;
      freeCam.pitch = Math.max(-1.5, Math.min(1.5, freeCam.pitch - (e.clientY - lastY) * 0.004));
      lastX = e.clientX;
      lastY = e.clientY;
      applyCamera();
    };
    const onWheel = (e: WheelEvent) => {
      if (isPlaying) return;
      const f = getForward();
      const step = e.deltaY * 0.01;
      freeCam.pos[0] += f[0] * step;
      freeCam.pos[1] += f[1] * step;
      freeCam.pos[2] += f[2] * step;
      applyCamera();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      keys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.code);
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    el.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('mousemove', onMove);
    el.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    el.addEventListener('contextmenu', onContextMenu);
    raf = requestAnimationFrame(tick);
    return () => {
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('mousemove', onMove);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      el.removeEventListener('contextmenu', onContextMenu);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [isPlaying]);

  // F-to-frame: focus camera on selected entity
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        const sel = useEditorStore.getState().selectedId;
        if (sel !== null) {
          const t = bridge.getTransform(sel);
          const [px, py, pz] = t.position;
          freeCam.pos = [px + 3, py + 2, pz + 3];
          const dx = px - freeCam.pos[0];
          const dy = py - freeCam.pos[1];
          const dz = pz - freeCam.pos[2];
          const xz = Math.hypot(dx, dz);
          freeCam.yaw = Math.atan2(dx, -dz);
          freeCam.pitch = Math.atan2(dy, Math.max(1e-6, xz));
          applyCamera();
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
    bridge.setGameMode(true);   // activate entity cameras for game play
    initScripts();
    bridge.startGameLoop((_deltaMs) => {
      tickScripts(_deltaMs);
      tickParticles(_deltaMs);
      onFrame();
      refresh();
      trackFps();
    });

    return () => {
      canvas.removeEventListener('click', onClick);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      bridge.stopLoop();
      bridge.setGameMode(false);  // restore orbital camera for editor
      clearParticles();
      bridge.setInput(0, 0, 0);
      document.exitPointerLock();
    };
  }, [isPlaying, refresh]);

  // Restart editor loop when leaving game mode.
  useEffect(() => {
    if (!isPlaying) {
      bridge.stopLoop();
      bridge.startLoop(() => {
        refresh();
        trackFps();
      });
    }
  }, [isPlaying, refresh]);

  return (
    <div ref={wrapRef} className="viewport-root" style={{ cursor: isPlaying ? 'none' : 'default' }}>
      <canvas ref={canvasRef} className="viewport-canvas" />
      <div className="viewport-grid" />
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          padding: '2px 6px',
          borderRadius: 4,
          border: '1px solid var(--border)',
          background: 'rgba(0,0,0,0.5)',
          color: '#fff',
          fontSize: 11,
          fontFamily: 'monospace',
          pointerEvents: 'none',
        }}
      >
        {fps} FPS
      </div>
      {!isPlaying && <GizmoOverlay width={dims.w} height={dims.h} />}
      {!isPlaying && <div className="viewport-hint">RMB look - WASD move - Q/E up/down - Shift boost - F focus</div>}
      {isPlaying && <div className="viewport-crosshair">+</div>}
      {isPlaying && <div className="viewport-hint">Click to capture mouse - Esc to release</div>}
    </div>
  );
}
