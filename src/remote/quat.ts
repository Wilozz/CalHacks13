export type V3 = [number, number, number];
export type Q = [number, number, number, number]; // x, y, z, w
export const QI: Q = [0, 0, 0, 1];

export const qMul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qInv = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]]; // unit quaternions
export const qNorm = (q: Q): Q => { const n = Math.hypot(q[0], q[1], q[2], q[3]); return n > 1e-9 ? [q[0] / n, q[1] / n, q[2] / n, q[3] / n] : QI; };
export const qAxisAngle = (axis: V3, angle: number): Q => { const s = Math.sin(angle / 2); return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)]; };

export function qRotate(q: Q, v: V3): V3 {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

/** Angle between two rotations, 0..PI. */
export const qAngle = (a: Q, b: Q) => 2 * Math.acos(Math.min(1, Math.abs(qMul(qInv(a), b)[3])));

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const n = Math.hypot(a[0], a[1], a[2]); return n > 1e-9 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0]; };

/** Rotation taking the unit axes to (x, y, z), assumed orthonormal and right-handed. */
export function qFromBasis(x: V3, y: V3, z: V3): Q {
  const m00 = x[0], m01 = y[0], m02 = z[0], m10 = x[1], m11 = y[1], m12 = z[1], m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; return qNorm([(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]); }
  if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; return qNorm([0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]); }
  if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; return qNorm([(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]); }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return qNorm([(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]);
}

/**
 * Orientation of the palm from hand points (twin space: x right, y up, z toward the viewer):
 * y runs wrist to middle knuckle, x runs across the palm from pinky to index knuckle, z is the palm normal.
 */
export function palmQuat(p: V3[]): Q | null {
  if (p.length < 18) return null;
  const y = norm(sub(p[9], p[0]));
  let x = norm(sub(p[5], p[17]));
  const z = norm(cross(x, y));
  if (!z[0] && !z[1] && !z[2]) return null;
  x = norm(cross(y, z));
  return qFromBasis(x, y, z);
}
