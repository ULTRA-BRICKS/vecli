/** Browser-safe geometry facade. This uses vecli's actual generators/path representation. */
import { rectangleNode } from "../nodes/generators/rectangle";
import { ellipseNode } from "../nodes/generators/ellipse";
import { polygonNode } from "../nodes/generators/polygon";
import { starNode } from "../nodes/generators/star";
import { lineNode } from "../nodes/generators/line";
import { svgPathNode } from "../nodes/generators/svg-path";
import { PathBuilder } from "../path/builder";
import { computeBounds } from "../path/bounds";
import { commandsToSvgD } from "../path/commands";
import type { NodeTypeDefinition, PathValue } from "../types";
export { PathBuilder } from "../path/builder";
export { commandsToSvgD, svgDToCommands, PathCmd } from "../path/commands";
export { computeBounds } from "../path/bounds";
export { transformPathCommands } from "../path/transform-path";
export { pointInPath, pointOnStroke } from "../path/hit-test";
export type { PathValue, BoundingBox } from "../types";
export const VECLI_GEOMETRY_VERSION = "0.1.0";
const generators: Readonly<Record<string, NodeTypeDefinition>> = Object.freeze({
  rectangle: rectangleNode,
  ellipse: ellipseNode,
  polygon: polygonNode,
  star: starNode,
  line: lineNode,
  path: svgPathNode,
});
export function generateGeometry(
  kind: string,
  supplied: Readonly<Record<string, unknown>>,
): {
  path: PathValue;
  d: string;
  bounds: ReturnType<typeof computeBounds>;
  backend: string;
} {
  if (!Object.hasOwn(generators, kind))
    throw new Error(`Unsupported vecli generator: ${kind}`);
  const generator = generators[kind]!,
    params: Record<string, unknown> = {};
  for (const definition of generator.params) {
    const value = Object.hasOwn(supplied, definition.name)
      ? supplied[definition.name]
      : definition.default;
    if (
      definition.type === "number" &&
      (typeof value !== "number" ||
        !Number.isFinite(value) ||
        Math.abs(value) > 1e6 ||
        (definition.min !== undefined && value < definition.min) ||
        (definition.max !== undefined && value > definition.max))
    )
      throw new Error(`Invalid vecli ${kind}.${definition.name}`);
    params[definition.name] = value;
  }
  if (
    (typeof params.points === "number" && params.points > 2048) ||
    (typeof params.sides === "number" && params.sides > 2048)
  )
    throw new Error("vecli generator vertex budget exceeded");
  if (typeof params.d === "string" && params.d.length > 100000)
    throw new Error("vecli SVG path budget exceeded");
  let path: PathValue;
  const radius = supplied.radius;
  if (
    radius !== undefined &&
    (typeof radius !== "number" ||
      !Number.isFinite(radius) ||
      radius < 0 ||
      radius > 1e6)
  )
    throw new Error("Invalid vecli rectangle.radius");
  const value = generator.execute({}, params).path;
  if (!value || Array.isArray(value) || value.type !== "path")
    throw new Error("vecli generator did not return path geometry");
  path = value.value;

  return {
    path,
    d: commandsToSvgD(path.commands),
    bounds: computeBounds(path.commands),
    backend: `vecli/${VECLI_GEOMETRY_VERSION}`,
  };
}
