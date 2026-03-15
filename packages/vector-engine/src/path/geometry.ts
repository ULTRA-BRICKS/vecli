/**
 * @file Geometry queries — path length, area, point-at-offset, tangent, normal
 *
 * Accessed via: Properties panel geometry readouts, variable stroke calculations,
 *   trim path operations
 * Tradeoffs: cubic length uses 5-point Gauss-Legendre quadrature (fast, ~0.01% error).
 *   Area uses shoelace on flattened polyline for curves.
 * Architecture: https://hyperide.github.io/reports/HYP-308
 */

import { decodeCommands, PathCmd } from './commands';
import { flattenPath } from './flatten';

// 5-point Gauss-Legendre quadrature nodes and weights on [-1, 1]
const GL_NODES = [-0.906_179_845_938_664, -0.538_469_310_105_683, 0, 0.538_469_310_105_683, 0.906_179_845_938_664];
const GL_WEIGHTS = [
  0.236_926_885_056_189, 0.478_628_670_499_366, 0.568_888_888_888_889, 0.478_628_670_499_366, 0.236_926_885_056_189,
];

function dist(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Cubic bezier derivative magnitude at parameter t.
 * B'(t) = 3[(1-t)^2(P1-P0) + 2t(1-t)(P2-P1) + t^2(P3-P2)]
 */
function cubicDerivMag(
  x0: number,
  y0: number,
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  x3: number,
  y3: number,
  t: number,
): number {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  const dx = 3 * (mt2 * (cx1 - x0) + 2 * t * mt * (cx2 - cx1) + t2 * (x3 - cx2));
  const dy = 3 * (mt2 * (cy1 - y0) + 2 * t * mt * (cy2 - cy1) + t2 * (y3 - cy2));
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Quadratic bezier derivative magnitude at parameter t.
 * B'(t) = 2[(1-t)(P1-P0) + t(P2-P1)]
 */
function quadDerivMag(x0: number, y0: number, cx: number, cy: number, x2: number, y2: number, t: number): number {
  const mt = 1 - t;
  const dx = 2 * (mt * (cx - x0) + t * (x2 - cx));
  const dy = 2 * (mt * (cy - y0) + t * (y2 - cy));
  return Math.sqrt(dx * dx + dy * dy);
}

/** 5-point Gauss-Legendre arc-length of a cubic bezier segment. */
function cubicLength(
  x0: number,
  y0: number,
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  x3: number,
  y3: number,
): number {
  let sum = 0;
  for (let i = 0; i < GL_NODES.length; i++) {
    // Map node from [-1,1] to [0,1]: t = 0.5*(1+xi)
    const t = 0.5 * (1 + GL_NODES[i]);
    sum += GL_WEIGHTS[i] * cubicDerivMag(x0, y0, cx1, cy1, cx2, cy2, x3, y3, t);
  }
  return 0.5 * sum;
}

/** 5-point Gauss-Legendre arc-length of a quadratic bezier segment. */
function quadLength(x0: number, y0: number, cx: number, cy: number, x2: number, y2: number): number {
  let sum = 0;
  for (let i = 0; i < GL_NODES.length; i++) {
    const t = 0.5 * (1 + GL_NODES[i]);
    sum += GL_WEIGHTS[i] * quadDerivMag(x0, y0, cx, cy, x2, y2, t);
  }
  return 0.5 * sum;
}

/**
 * Compute total arc-length of a path (Float64Array of encoded commands).
 *
 * Lines: Euclidean distance.
 * Cubics/Quads: 5-point Gauss-Legendre quadrature (~0.01% error).
 * Arcs: flattened to polyline and summed (analytical ellipse arc length is complex).
 * Close: adds distance from current point back to subpath start.
 */
export function pathLength(commands: Float64Array): number {
  if (commands.length === 0) return 0;

  const decoded = decodeCommands(commands);
  let total = 0;
  let lastX = 0;
  let lastY = 0;
  let startX = 0;
  let startY = 0;

  for (const cmd of decoded) {
    switch (cmd.type) {
      case PathCmd.Move:
        lastX = cmd.x;
        lastY = cmd.y;
        startX = cmd.x;
        startY = cmd.y;
        break;
      case PathCmd.Line:
        total += dist(lastX, lastY, cmd.x, cmd.y);
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      case PathCmd.Cubic:
        total += cubicLength(lastX, lastY, cmd.cx1, cmd.cy1, cmd.cx2, cmd.cy2, cmd.x, cmd.y);
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      case PathCmd.Quad:
        total += quadLength(lastX, lastY, cmd.cx, cmd.cy, cmd.x, cmd.y);
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      case PathCmd.Arc: {
        // Flatten arc to polyline and sum segment lengths.
        // Use tight tolerance (0.001) — 0.5 underestimates small-radius arcs by ~10%.
        const arcCmds = new Float64Array([
          PathCmd.Move,
          lastX,
          lastY,
          PathCmd.Arc,
          cmd.rx,
          cmd.ry,
          cmd.rotation,
          cmd.largeArc,
          cmd.sweep,
          cmd.x,
          cmd.y,
        ]);
        const pts = flattenPath(arcCmds, 0.001);
        for (let i = 1; i < pts.length; i++) {
          total += dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
        }
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      }
      case PathCmd.Close:
        total += dist(lastX, lastY, startX, startY);
        lastX = startX;
        lastY = startY;
        break;
    }
  }

  return total;
}

/** Shoelace area of a closed polygon (point array). */
function shoelaceArea(pts: { x: number; y: number }[]): number {
  const n = pts.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return sum / 2;
}

/**
 * Compute signed area of a path using the shoelace formula on a flattened polyline.
 *
 * Each subpath (separated by Move commands) is processed independently —
 * compound paths are handled correctly by summing per-contour areas.
 * Returns positive area for clockwise winding (screen coordinates, y-down),
 * negative for counter-clockwise.
 */
export function pathArea(commands: Float64Array): number {
  if (commands.length === 0) return 0;

  // Split encoded commands into subpath buffers at each Move command,
  // then flatten and apply shoelace per subpath.
  const decoded = decodeCommands(commands);
  let total = 0;

  // Collect command indices where subpaths start (Move commands)
  const subpathStarts: number[] = [];
  for (let i = 0; i < decoded.length; i++) {
    if (decoded[i].type === PathCmd.Move) subpathStarts.push(i);
  }

  for (let s = 0; s < subpathStarts.length; s++) {
    const start = subpathStarts[s];
    const end = s + 1 < subpathStarts.length ? subpathStarts[s + 1] : decoded.length;
    const subCmds = decoded.slice(start, end);

    // Only contours with drawable commands (not just a lone Move) contribute area
    const hasDrawing = subCmds.some((c) => c.type !== PathCmd.Move);
    if (!hasDrawing) continue;

    // Re-encode this subpath into a Float64Array so flattenPath can process it
    let size = 0;
    for (const c of subCmds) {
      switch (c.type) {
        case PathCmd.Move:
        case PathCmd.Line:
          size += 3;
          break;
        case PathCmd.Cubic:
          size += 7;
          break;
        case PathCmd.Quad:
          size += 5;
          break;
        case PathCmd.Arc:
          size += 8;
          break;
        case PathCmd.Close:
          size += 1;
          break;
      }
    }
    const buf = new Float64Array(size);
    let off = 0;
    for (const c of subCmds) {
      buf[off++] = c.type;
      switch (c.type) {
        case PathCmd.Move:
        case PathCmd.Line:
          buf[off++] = c.x;
          buf[off++] = c.y;
          break;
        case PathCmd.Cubic:
          buf[off++] = c.cx1;
          buf[off++] = c.cy1;
          buf[off++] = c.cx2;
          buf[off++] = c.cy2;
          buf[off++] = c.x;
          buf[off++] = c.y;
          break;
        case PathCmd.Quad:
          buf[off++] = c.cx;
          buf[off++] = c.cy;
          buf[off++] = c.x;
          buf[off++] = c.y;
          break;
        case PathCmd.Arc:
          buf[off++] = c.rx;
          buf[off++] = c.ry;
          buf[off++] = c.rotation;
          buf[off++] = c.largeArc;
          buf[off++] = c.sweep;
          buf[off++] = c.x;
          buf[off++] = c.y;
          break;
        case PathCmd.Close:
          break;
      }
    }

    const pts = flattenPath(buf, 0.5);
    if (pts.length >= 3) {
      total += shoelaceArea(pts);
    }
  }

  return total;
}
