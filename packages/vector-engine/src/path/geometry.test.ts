import { describe, expect, it } from 'bun:test';
import { encodeCommands, PathCmd } from './commands';
import { pathArea, pathLength } from './geometry';

describe('pathLength', () => {
  it('should compute line segment length', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
    ]);
    expect(pathLength(cmds)).toBeCloseTo(100, 5);
  });

  it('should compute polyline length', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 100 },
    ]);
    expect(pathLength(cmds)).toBeCloseTo(200, 5);
  });

  it('should approximate cubic bezier length via Gauss-Legendre', () => {
    // Quarter-circle approximation: known length ≈ π/2 * 50 ≈ 78.54
    const k = 0.5522847498;
    const r = 50;
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: r, y: 0 },
      { type: PathCmd.Cubic, cx1: r, cy1: r * k, cx2: r * k, cy2: r, x: 0, y: r },
    ]);
    expect(pathLength(cmds)).toBeCloseTo((Math.PI / 2) * r, 0);
  });

  it('should compute quad bezier length', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Quad, cx: 50, cy: 100, x: 100, y: 0 },
    ]);
    const len = pathLength(cmds);
    // Quad bezier should be longer than chord (100) but shorter than going through control point
    expect(len).toBeGreaterThan(100);
    expect(len).toBeLessThan(224); // 100 + 2*sqrt(50^2+100^2) ≈ 223.6
  });

  it('should handle empty path', () => {
    const cmds = encodeCommands([]);
    expect(pathLength(cmds)).toBe(0);
  });

  it('should handle close command', () => {
    // Triangle: perimeter should be sum of 3 sides
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 50, y: 86.6 },
      { type: PathCmd.Close },
    ]);
    const len = pathLength(cmds);
    // Close adds segment back to start (50,86.6) → (0,0) ≈ 100
    // Total ≈ 100 + 93.3 + 100 ≈ 293
    expect(len).toBeGreaterThan(280);
    expect(len).toBeLessThan(300);
  });
});

describe('pathArea', () => {
  it('should compute area of a unit square', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 100 },
      { type: PathCmd.Line, x: 0, y: 100 },
      { type: PathCmd.Close },
    ]);
    expect(Math.abs(pathArea(cmds))).toBeCloseTo(10000, 0);
  });

  it('should return positive for CW winding, negative for CCW', () => {
    const cw = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 100 },
      { type: PathCmd.Close },
    ]);
    const ccw = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 0, y: 100 },
      { type: PathCmd.Line, x: 100, y: 100 },
      { type: PathCmd.Close },
    ]);
    expect(Math.sign(pathArea(cw))).not.toBe(Math.sign(pathArea(ccw)));
  });

  it('should handle empty path', () => {
    expect(pathArea(new Float64Array(0))).toBe(0);
  });

  it('should return zero for a path of only Move commands', () => {
    // A path with only moves has no contour — area must be 0
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Move, x: 10, y: 0 },
      { type: PathCmd.Move, x: 10, y: 10 },
    ]);
    expect(pathArea(cmds)).toBe(0);
  });

  it('should compute sum of contour areas for compound paths', () => {
    // Two disjoint squares: each 100x100 = 10000. Total abs area = 20000.
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 100 },
      { type: PathCmd.Line, x: 0, y: 100 },
      { type: PathCmd.Close },
      { type: PathCmd.Move, x: 200, y: 0 },
      { type: PathCmd.Line, x: 300, y: 0 },
      { type: PathCmd.Line, x: 300, y: 100 },
      { type: PathCmd.Line, x: 200, y: 100 },
      { type: PathCmd.Close },
    ]);
    expect(Math.abs(pathArea(cmds))).toBeCloseTo(20000, 0);
  });
});
