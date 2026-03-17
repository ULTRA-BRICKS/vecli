/**
 * @file Utility helpers — convenience functions for elegant one-liners
 *
 * Accessed via: Global functions in sandbox — grid(), radial(), rainbow(), etc.
 */

import type { ChainableNode } from './chainable';
import type { EvalContext } from './context';

/** Generate HSL color from index. rainbow(i, total) → "#rrggbb" */
export function rainbow(index: number, total: number): string {
  const hue = Math.round((index / total) * 360);
  return hslToHex(hue, 80, 50);
}

/** HSL to hex color */
export function hslToHex(h: number, s: number, l: number): string {
  const sl = s / 100;
  const ll = l / 100;
  const a = sl * Math.min(ll, 1 - ll);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = ll - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Generate a color palette. palette(5) → ["#ff0000", "#ff9900", ...] */
export function palette(count: number, saturation = 80, lightness = 50): string[] {
  return Array.from({ length: count }, (_, i) => {
    const hue = Math.round((i / count) * 360);
    return hslToHex(hue, saturation, lightness);
  });
}

/** Lerp between two values */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Random number in range (seeded for reproducibility) */
let seed = 42;
export function random(min = 0, max = 1): number {
  seed = (seed * 16807 + 0) % 2147483647;
  return min + (seed / 2147483647) * (max - min);
}

export function setSeed(s: number): void {
  seed = s;
}

/** Degrees to radians */
export function deg(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Point on circle */
export function pointOnCircle(cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } {
  const rad = deg(angleDeg);
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

/**
 * Create helpers that need EvalContext (they create nodes).
 * These are factory functions that return the globals to inject.
 */
export function createHelpers(_ctx: EvalContext): Record<string, unknown> {
  return {
    /** Create grid of shapes: grid(cols, rows, spacing, fn) */
    grid: (
      cols: number,
      rows: number,
      spacing: number,
      fn: (x: number, y: number, i: number) => ChainableNode,
    ): ChainableNode[] => {
      const results: ChainableNode[] = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const x = col * spacing;
          const y = row * spacing;
          results.push(fn(x, y, row * cols + col));
        }
      }
      return results;
    },

    /** Create radial arrangement: radial(count, radius, fn) */
    radial: (
      count: number,
      radius: number,
      fn: (angle: number, i: number, x: number, y: number) => ChainableNode,
      cx = 0,
      cy = 0,
    ): ChainableNode[] => {
      const results: ChainableNode[] = [];
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * 360;
        const pt = pointOnCircle(cx, cy, radius, angle);
        results.push(fn(angle, i, pt.x, pt.y));
      }
      return results;
    },

    /** Repeat shape n times with transform: repeat(n, fn) */
    repeat: (n: number, fn: (i: number, t: number) => ChainableNode): ChainableNode[] => {
      return Array.from({ length: n }, (_, i) => fn(i, i / (n - 1 || 1)));
    },

    // Pure math helpers (no context needed)
    rainbow,
    palette,
    lerp,
    random,
    setSeed,
    deg,
    pointOnCircle,
    hsl: hslToHex,
  };
}
