/**
 * @file Rectangle generator node
 *
 * Accessed via: Vector toolbar > Shape picker > Rectangle
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Generator Nodes
 */

import { PathBuilder } from "../../path/builder";
import type { NodeTypeDefinition } from "../../types";

export const rectangleNode: NodeTypeDefinition = {
  type: "rectangle",
  label: "Rectangle",
  category: "generator",
  inputs: [],
  outputs: [{ name: "path", type: "path" }],
  params: [
    { name: "width", type: "number", default: 100, min: 0 },
    { name: "height", type: "number", default: 100, min: 0 },
    { name: "x", type: "number", default: 0 },
    { name: "y", type: "number", default: 0 },
    { name: "radius", type: "number", default: 0, min: 0 },
  ],
  execute(_inputs, params) {
    const { width, height, x, y } = params as {
      width: number;
      height: number;
      x: number;
      y: number;
    };
    const radius = typeof params.radius === "number" ? params.radius : 0;
    if (!Number.isFinite(radius) || radius < 0)
      throw new Error("Rectangle radius must be finite and non-negative");
    if (radius > 0) {
      const r = Math.min(radius, width / 2, height / 2),
        k = 0.5522847498;
      const path = new PathBuilder()
        .moveTo(x + r, y)
        .lineTo(x + width - r, y)
        .cubicTo(
          x + width - r + k * r,
          y,
          x + width,
          y + r - k * r,
          x + width,
          y + r,
        )
        .lineTo(x + width, y + height - r)
        .cubicTo(
          x + width,
          y + height - r + k * r,
          x + width - r + k * r,
          y + height,
          x + width - r,
          y + height,
        )
        .lineTo(x + r, y + height)
        .cubicTo(
          x + r - k * r,
          y + height,
          x,
          y + height - r + k * r,
          x,
          y + height - r,
        )
        .lineTo(x, y + r)
        .cubicTo(x, y + r - k * r, x + r - k * r, y, x + r, y)
        .close()
        .build();
      return { path: { type: "path", value: path } };
    }
    const path = new PathBuilder()
      .moveTo(x, y)
      .lineTo(x + width, y)
      .lineTo(x + width, y + height)
      .lineTo(x, y + height)
      .close()
      .build();
    return { path: { type: "path", value: path } };
  },
};
