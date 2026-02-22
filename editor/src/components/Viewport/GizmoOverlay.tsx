import { useRef, useEffect, useCallback } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { useSceneStore } from '../../store/sceneStore';
import { bridge } from '../../engine/engineBridge';
import { project, AXIS_COLORS, AXIS_DIRS } from '../../utils/gizmo';

const HANDLE_R = 7;

export default function GizmoOverlay({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragAxis  = useRef<number | null>(null);
  const dragStart = useRef<[number, number]>([0, 0]);

  const selectedId = useEditorStore(s => s.selectedId);
  const gizmoMode  = useEditorStore(s => s.gizmoMode);
  const isPlaying  = useEditorStore(s => s.isPlaying);
  const entity     = useSceneStore(s => s.entities.find(e => e.id === selectedId));
  const updatePos  = useSceneStore(s => s.updatePosition);

  const getEndpoints = useCallback(() => {
    if (!entity || gizmoMode !== 'translate' || !bridge.isReady) return null;
    const vp     = bridge.getViewProj();
    const origin = project(entity.transform.position, vp, width, height);
    if (!origin) return null;
    const tips = AXIS_DIRS.map(dir => {
      const tip: [number, number, number] = [
        entity.transform.position[0] + dir[0],
        entity.transform.position[1] + dir[1],
        entity.transform.position[2] + dir[2],
      ];
      return project(tip, vp, width, height);
    });
    return { origin, tips };
  }, [entity, gizmoMode, width, height]);

  // Redessine à chaque changement d'état
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, width, height);
    if (!entity || isPlaying || gizmoMode !== 'translate') return;
    const ends = getEndpoints();
    if (!ends) return;

    const { origin, tips } = ends;
    tips.forEach((tip, i) => {
      if (!tip) return;
      ctx.beginPath();
      ctx.moveTo(origin[0], origin[1]);
      ctx.lineTo(tip[0], tip[1]);
      ctx.strokeStyle = AXIS_COLORS[i];
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tip[0], tip[1], HANDLE_R, 0, Math.PI * 2);
      ctx.fillStyle = AXIS_COLORS[i];
      ctx.fill();
    });
    ctx.beginPath();
    ctx.arc(origin[0], origin[1], 4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }, [entity, gizmoMode, isPlaying, width, height, getEndpoints]);

  // Drag
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !entity || gizmoMode !== 'translate') return;

    const onDown = (e: MouseEvent) => {
      const ends = getEndpoints();
      if (!ends) return;
      ends.tips.forEach((tip, i) => {
        if (!tip) return;
        const dx = e.offsetX - tip[0], dy = e.offsetY - tip[1];
        if (Math.hypot(dx, dy) < HANDLE_R + 4) {
          dragAxis.current  = i;
          dragStart.current = [e.clientX, e.clientY];
          e.stopPropagation();
        }
      });
    };
    const onMove = (e: MouseEvent) => {
      const axis = dragAxis.current;
      if (axis === null || !entity) return;
      const dx = e.clientX - dragStart.current[0];
      const dy = e.clientY - dragStart.current[1];
      dragStart.current = [e.clientX, e.clientY];
      const delta = (Math.abs(dx) > Math.abs(dy) ? dx : -dy) * 0.02;
      const [px, py, pz] = entity.transform.position;
      updatePos(entity.id,
        px + (axis === 0 ? delta : 0),
        py + (axis === 1 ? delta : 0),
        pz + (axis === 2 ? delta : 0),
      );
    };
    const onUp = () => { dragAxis.current = null; };

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [entity, gizmoMode, getEndpoints, updatePos]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: 'absolute', top: 0, left: 0, pointerEvents: isPlaying ? 'none' : 'auto',
      }}
    />
  );
}
