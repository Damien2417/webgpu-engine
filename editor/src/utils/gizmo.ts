/**
 * Projette un point 3D en coordonnées écran.
 * viewProj : Float32Array[16] column-major (glam to_cols_array)
 * v_clip = viewProj * [x, y, z, 1]
 */
export function project(
  worldPos: [number, number, number],
  viewProj: Float32Array,
  width: number,
  height: number,
): [number, number] | null {
  const [x, y, z] = worldPos;
  const cx = viewProj[0]*x + viewProj[4]*y + viewProj[8]*z  + viewProj[12];
  const cy = viewProj[1]*x + viewProj[5]*y + viewProj[9]*z  + viewProj[13];
  const cw = viewProj[3]*x + viewProj[7]*y + viewProj[11]*z + viewProj[15];
  if (Math.abs(cw) < 1e-6) return null;
  const ndcX = cx / cw;
  const ndcY = cy / cw;
  if (ndcX < -1.5 || ndcX > 1.5 || ndcY < -1.5 || ndcY > 1.5) return null;
  return [
    (ndcX + 1) * 0.5 * width,
    (1 - ndcY) * 0.5 * height,
  ];
}

export const AXIS_COLORS = ['#e74c3c', '#2ecc71', '#3498db'] as const;

export const AXIS_DIRS: [number, number, number][] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
