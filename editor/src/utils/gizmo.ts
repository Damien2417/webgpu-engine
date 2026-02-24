export function project(
  worldPos: [number, number, number],
  viewProj: Float32Array,
  width: number,
  height: number,
): [number, number] | null {
  const [x, y, z] = worldPos;
  const m = viewProj;
  const cx = m[0]*x + m[4]*y + m[8]*z  + m[12];
  const cy = m[1]*x + m[5]*y + m[9]*z  + m[13];
  const cz = m[2]*x + m[6]*y + m[10]*z + m[14];
  const cw = m[3]*x + m[7]*y + m[11]*z + m[15];
  if (Math.abs(cw) < 1e-6) return null;
  const ndcX = cx / cw;
  const ndcY = cy / cw;
  const ndcZ = cz / cw;
  if (ndcZ < -1 || ndcZ > 1) return null;
  return [
    (ndcX * 0.5 + 0.5) * width,
    (1 - (ndcY * 0.5 + 0.5)) * height,
  ];
}

export const AXIS_COLORS = ['#e74c3c', '#2ecc71', '#3498db'] as const;
export const AXIS_DIRS: [number, number, number][] = [[1,0,0],[0,1,0],[0,0,1]];
export const HANDLE_R = 7;
export const ROTATE_RADII = [35, 47, 59];

export function drawTranslateGizmo(
  ctx: CanvasRenderingContext2D,
  origin: [number, number],
  tips: ([number, number] | null)[],
) {
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
}

export function drawRotateGizmo(
  ctx: CanvasRenderingContext2D,
  origin: [number, number],
) {
  ROTATE_RADII.forEach((r, i) => {
    ctx.beginPath();
    ctx.arc(origin[0], origin[1], r, 0, Math.PI * 2);
    ctx.strokeStyle = AXIS_COLORS[i];
    ctx.lineWidth = 2.5;
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.arc(origin[0], origin[1], 4, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

export function drawScaleGizmo(
  ctx: CanvasRenderingContext2D,
  origin: [number, number],
  tips: ([number, number] | null)[],
) {
  tips.forEach((tip, i) => {
    if (!tip) return;
    ctx.beginPath();
    ctx.moveTo(origin[0], origin[1]);
    ctx.lineTo(tip[0], tip[1]);
    ctx.strokeStyle = AXIS_COLORS[i];
    ctx.lineWidth = 2;
    ctx.stroke();
    const s = HANDLE_R;
    ctx.fillStyle = AXIS_COLORS[i];
    ctx.fillRect(tip[0] - s/2, tip[1] - s/2, s, s);
  });
  ctx.beginPath();
  ctx.arc(origin[0], origin[1], 4, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

export function hitTestTranslate(
  mx: number, my: number,
  tips: ([number, number] | null)[],
): number | null {
  for (let i = 0; i < tips.length; i++) {
    const tip = tips[i];
    if (!tip) continue;
    if (Math.hypot(mx - tip[0], my - tip[1]) < HANDLE_R + 4) return i;
  }
  return null;
}

export function hitTestRotate(
  mx: number, my: number,
  origin: [number, number],
): number | null {
  const dist = Math.hypot(mx - origin[0], my - origin[1]);
  for (let i = 0; i < ROTATE_RADII.length; i++) {
    if (Math.abs(dist - ROTATE_RADII[i]) < 6) return i;
  }
  return null;
}

export function hitTestScale(
  mx: number, my: number,
  tips: ([number, number] | null)[],
): number | null {
  const s = HANDLE_R + 4;
  for (let i = 0; i < tips.length; i++) {
    const tip = tips[i];
    if (!tip) continue;
    if (Math.abs(mx - tip[0]) < s && Math.abs(my - tip[1]) < s) return i;
  }
  return null;
}
