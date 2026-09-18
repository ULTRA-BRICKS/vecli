import { test, expect } from "bun:test";
import { generateGeometry } from "./geometry";
import { rectangleNode } from "../nodes/generators/rectangle";
import { commandsToSvgD } from "../path/commands";
test("portable facade is exactly the CLI generator geometry", () => {
  const raw = rectangleNode.execute(
    {},
    { width: 123, height: 55, x: 0, y: 0 },
  ).path;
  if (!raw || Array.isArray(raw) || raw.type !== "path")
    throw new Error("Expected path");
  expect(generateGeometry("rectangle", { width: 123, height: 55 }).d).toBe(
    commandsToSvgD(raw.value.commands),
  );
});
test("rounded rectangles use bounded vecli paths; ellipse bounds are preserved", () => {
  expect(
    generateGeometry("rectangle", { width: 100, height: 50, radius: 999 })
      .bounds,
  ).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  expect(
    generateGeometry("ellipse", { rx: 20, ry: 30, cx: 20, cy: 30 }).bounds
      .width,
  ).toBe(40);
});
test("bad inputs fail; no mock geometry or unbounded generators", () => {
  expect(() => generateGeometry("boolean", {})).toThrow();
  expect(() => generateGeometry("star", { points: 1e6 })).toThrow(/budget/);
  expect(() => generateGeometry("rectangle", { width: NaN })).toThrow();
});
test("malformed encoded paths and invalid corner radius fail explicitly", async () => {
  const { decodeCommands, PathCmd } = await import("../path/commands");
  expect(() => decodeCommands(new Float64Array([PathCmd.Move, 1]))).toThrow(
    /Truncated/,
  );
  expect(() =>
    decodeCommands(new Float64Array([PathCmd.Move, NaN, 2])),
  ).toThrow(/finite/);
  expect(() => generateGeometry("rectangle", { radius: NaN })).toThrow(
    /radius/,
  );
});

test("raw graph/CLI execution supplies declared defaults instead of producing NaN", async () => {
  const { createContext, executeAndRender } = await import(
    "../../../vector-cli/src/context"
  );
  const ctx = createContext();
  ctx.graph.addNode({ type: "rectangle", params: { width: 42, height: 17 } });
  expect(executeAndRender(ctx)).toContain("42");
  expect(executeAndRender(ctx)).not.toContain("NaN");
});

test("rounded facade uses the exact same generator as CLI", () => {
  const params = { width: 100, height: 50, x: 0, y: 0, radius: 12 };
  const raw = rectangleNode.execute({}, params).path;
  if (!raw || Array.isArray(raw) || raw.type !== "path")
    throw new Error("Expected path");
  expect(generateGeometry("rectangle", params).d).toBe(
    commandsToSvgD(raw.value.commands),
  );
});

test('untrusted path strings terminate instead of freezing the process',async()=>{
 const {spawnSync}=await import('node:child_process');
 for(const d of ['1','M0 0Z1']){
  const result=spawnSync(process.execPath,['-e',`import {generateGeometry} from './packages/vector-engine/src/portable/geometry';try{generateGeometry('path',{d:${JSON.stringify(d)}});process.exitCode=2;}catch{console.log('rejected');}`],{cwd:process.cwd(),timeout:1000,encoding:'utf8'});
  expect(result.error).toBeUndefined();expect(result.status).toBe(0);expect(result.stdout).toContain('rejected');
 }
});

test('SVG scientific coordinates and smooth controls preserve path semantics',async()=>{const {svgDToCommands,decodeCommands,PathCmd}=await import('../path/commands');expect(decodeCommands(svgDToCommands('M1e2 +3 L2e2 -4'))[0]).toMatchObject({x:100,y:3});const cubic=decodeCommands(svgDToCommands('M0 0 C10 10 20 30 40 40 S60 60 80 80'))[2];expect(cubic).toMatchObject({type:PathCmd.Cubic,cx1:60,cy1:50});for(const d of ['M1','M0 0LNaN 2','M0 0@'])expect(()=>svgDToCommands(d)).toThrow();});
