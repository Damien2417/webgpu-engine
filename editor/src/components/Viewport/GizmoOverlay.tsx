import { useRef, useEffect, useCallback } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { useSceneStore } from '../../store/sceneStore';
import { bridge } from '../../engine/engineBridge';
import {
  project, AXIS_DIRS,
  drawTranslateGizmo, drawRotateGizmo, drawScaleGizmo,
  hitTestTranslate, hitTestRotate, hitTestScale,
} from '../../utils/gizmo';

export default function GizmoOverlay({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragAxis  = useRef<number | null>(null);
  const dragStart = useRef<[number, number]>([0, 0]);

  const selectedId  = useEditorStore(s => s.selectedId);
  const gizmoMode   = useEditorStore(s => s.gizmoMode);
  const isPlaying   = useEditorStore(s => s.isPlaying);
  const select      = useEditorStore(s => s.select);
  const entity      = useSceneStore(s => s.entities.find(e => e.id === selectedId));
  const entities    = useSceneStore(s => s.entities);
  const updatePos   = useSceneStore(s => s.updatePosition);
  const updateRot   = useSceneStore(s => s.updateRotation);
  const updateScale = useSceneStore(s => s.updateScale);

  const getScreenData = useCallback(() => {
    if (!bridge.isReady) return null;
    const vp = bridge.getViewProj();
    if (!entity) return { vp, origin: null as null, tips: [] as ([number,number]|null)[] };
    const origin = project(entity.transform.position, vp, width, height);
    if (!origin) return null;
    const tips = AXIS_DIRS.map(dir => {
      const tip: [number,number,number] = [
        entity.transform.position[0] + dir[0],
        entity.transform.position[1] + dir[1],
        entity.transform.position[2] + dir[2],
      ];
      return project(tip, vp, width, height);
    });
    return { vp, origin, tips };
  }, [entity, width, height]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, width, height);
    if (!entity || isPlaying) return;
    const data = getScreenData();
    if (!data?.origin) return;
    const { origin, tips } = data;
    if (gizmoMode === 'translate') drawTranslateGizmo(ctx, origin, tips);
    else if (gizmoMode === 'rotate') drawRotateGizmo(ctx, origin);
    else if (gizmoMode === 'scale')  drawScaleGizmo(ctx, origin, tips);
  }, [entity, gizmoMode, isPlaying, width, height, getScreenData]);

  // Interaction
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isPlaying || !bridge.isReady) return;

    const onDown = (e: MouseEvent) => {
      const data = getScreenData();
      let hitAxis: number | null = null;

      if (data?.origin) {
        if (gizmoMode === 'translate') hitAxis = hitTestTranslate(e.offsetX, e.offsetY, data.tips);
        else if (gizmoMode === 'rotate') hitAxis = hitTestRotate(e.offsetX, e.offsetY, data.origin);
        else if (gizmoMode === 'scale')  hitAxis = hitTestScale(e.offsetX, e.offsetY, data.tips);
      }

      if (hitAxis !== null) {
        dragAxis.current  = hitAxis;
        dragStart.current = [e.clientX, e.clientY];
        e.stopPropagation();
        return;
      }

      // Click-to-select: find nearest entity on screen
      if (!bridge.isReady) return;
      const vp = bridge.getViewProj();
      let bestId: number | null = null;
      let bestDist = 20;
      for (const ent of entities) {
        const sp = project(ent.transform.position, vp, width, height);
        if (!sp) continue;
        const d = Math.hypot(e.offsetX - sp[0], e.offsetY - sp[1]);
        if (d < bestDist) { bestDist = d; bestId = ent.id; }
      }
      if (bestId !== null) select(bestId);
    };

    const onMove = (e: MouseEvent) => {
      const axis = dragAxis.current;
      if (axis === null || !entity) return;
      const dx = e.clientX - dragStart.current[0];
      const dy = e.clientY - dragStart.current[1];
      dragStart.current = [e.clientX, e.clientY];
      const delta = (Math.abs(dx) > Math.abs(dy) ? dx : -dy) * 0.02;

      if (gizmoMode === 'translate') {
        const live = bridge.getTransform(entity.id);
        const [px, py, pz] = live.position;
        updatePos(entity.id,
          px + (axis === 0 ? delta : 0),
          py + (axis === 1 ? delta : 0),
          pz + (axis === 2 ? delta : 0),
        );
      } else if (gizmoMode === 'rotate') {
        const live = bridge.getTransform(entity.id);
        const [rx, ry, rz] = live.rotation;
        const deg = delta * 2;
        updateRot(entity.id,
          rx + (axis === 0 ? deg : 0),
          ry + (axis === 1 ? deg : 0),
          rz + (axis === 2 ? deg : 0),
        );
      } else if (gizmoMode === 'scale') {
        const live = bridge.getTransform(entity.id);
        const [sx, sy, sz] = live.scale;
        const scale = 1 + delta * 0.5;
        updateScale(entity.id,
          sx * (axis === 0 ? scale : 1),
          sy * (axis === 1 ? scale : 1),
          sz * (axis === 2 ? scale : 1),
        );
      }
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
  }, [entity, entities, gizmoMode, isPlaying, getScreenData, select, updatePos, updateRot, updateScale, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: isPlaying ? 'none' : 'auto' }}
    />
  );
}
