import { describe, expect, it } from 'bun:test';
import { createContext } from '../src/context';
import { deg, hslToHex, lerp, palette, pointOnCircle, rainbow } from '../src/helpers';
import { runInSandbox } from '../src/sandbox';

describe('helpers', () => {
  describe('rainbow', () => {
    it('should return hex color', () => {
      const color = rainbow(0, 10);
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('should cycle through hues', () => {
      const c0 = rainbow(0, 4);
      const c1 = rainbow(1, 4);
      const c2 = rainbow(2, 4);
      expect(c0).not.toBe(c1);
      expect(c1).not.toBe(c2);
    });
  });

  describe('palette', () => {
    it('should return array of colors', () => {
      const colors = palette(5);
      expect(colors.length).toBe(5);
      for (const c of colors) {
        expect(c).toMatch(/^#[0-9a-f]{6}$/);
      }
    });
  });

  describe('lerp', () => {
    it('should interpolate', () => {
      expect(lerp(0, 100, 0.5)).toBe(50);
      expect(lerp(0, 100, 0)).toBe(0);
      expect(lerp(0, 100, 1)).toBe(100);
    });
  });

  describe('hslToHex', () => {
    it('should convert red', () => {
      expect(hslToHex(0, 100, 50)).toBe('#ff0000');
    });
    it('should convert green-ish', () => {
      expect(hslToHex(120, 100, 50)).toBe('#00ff00');
    });
  });

  describe('pointOnCircle', () => {
    it('should compute point at 0 degrees', () => {
      const p = pointOnCircle(0, 0, 100, 0);
      expect(p.x).toBeCloseTo(100, 1);
      expect(p.y).toBeCloseTo(0, 1);
    });
    it('should compute point at 90 degrees', () => {
      const p = pointOnCircle(0, 0, 100, 90);
      expect(p.x).toBeCloseTo(0, 1);
      expect(p.y).toBeCloseTo(100, 1);
    });
  });

  describe('deg', () => {
    it('should convert degrees to radians', () => {
      expect(deg(180)).toBeCloseTo(Math.PI, 5);
      expect(deg(90)).toBeCloseTo(Math.PI / 2, 5);
    });
  });

  describe('sandbox integration', () => {
    it('should use rainbow in sandbox', () => {
      const ctx = createContext(200, 200);
      runInSandbox(
        ctx,
        `
        for (let i = 0; i < 5; i++) {
          circle(10).translate(i * 30 + 15, 100).fill(rainbow(i, 5))
        }
      `,
      );
      expect(ctx.graph.nodeCount).toBe(15); // 5 * (circle + translate + fill)
    });

    it('should use grid in sandbox', () => {
      const ctx = createContext(200, 200);
      runInSandbox(
        ctx,
        `
        grid(3, 3, 50, (x, y, i) =>
          rect(40, 40).translate(x, y).fill(rainbow(i, 9))
        )
      `,
      );
      expect(ctx.graph.nodeCount).toBe(27); // 9 * (rect + translate + fill)
    });

    it('should use radial in sandbox', () => {
      const ctx = createContext(200, 200);
      runInSandbox(
        ctx,
        `
        radial(6, 60, (angle, i, x, y) =>
          circle(10).translate(x + 100, y + 100).fill(rainbow(i, 6))
        )
      `,
      );
      expect(ctx.graph.nodeCount).toBe(18); // 6 * (circle + translate + fill)
    });

    it('should use repeat in sandbox', () => {
      const ctx = createContext(200, 20);
      runInSandbox(
        ctx,
        `
        repeat(5, (i, t) =>
          circle(lerp(5, 15, t)).translate(i * 40 + 20, 10).fill(rainbow(i, 5))
        )
      `,
      );
      expect(ctx.graph.nodeCount).toBe(15);
    });

    it('should use palette in sandbox', () => {
      const ctx = createContext(200, 200);
      runInSandbox(
        ctx,
        `
        const colors = palette(4)
        for (let i = 0; i < colors.length; i++) {
          rect(40, 40).translate(i * 50, 0).fill(colors[i])
        }
      `,
      );
      expect(ctx.graph.nodeCount).toBe(12);
    });

    it('should use hsl in sandbox', () => {
      const ctx = createContext();
      runInSandbox(
        ctx,
        `
        rect(100, 100).fill(hsl(200, 80, 50))
      `,
      );
      expect(ctx.graph.nodeCount).toBe(2);
    });

    it('should use pointOnCircle in sandbox', () => {
      const ctx = createContext(200, 200);
      runInSandbox(
        ctx,
        `
        const p = pointOnCircle(100, 100, 50, 45)
        circle(5).translate(p.x, p.y).fill("#f00")
      `,
      );
      expect(ctx.graph.nodeCount).toBe(3);
    });
  });
});
