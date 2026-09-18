import { describe, test, expect } from "bun:test";
import {
  compile,
  parse,
  print,
  sourceNodesAt,
  type LanguageHost,
} from "../src";
const specs: Record<
  string,
  {
    params: Record<string, unknown>;
    inputs: Record<string, { type: string }>;
    outputs: Record<string, { type: string }>;
  }
> = {
  number: {
    params: { value: 0 },
    inputs: {},
    outputs: { value: { type: "number" } },
  },
  expr: {
    params: { expression: "a", a: 0, b: 0, c: 0 },
    inputs: {
      a: { type: "number" },
      b: { type: "number" },
      c: { type: "number" },
    },
    outputs: { value: { type: "number" } },
  },
  rect: {
    params: { width: 100, height: 100, fill: "#000000" },
    inputs: { width: { type: "number" }, height: { type: "number" } },
    outputs: { image: { type: "image" } },
  },
  layer: {
    params: { x: 0, y: 0 },
    inputs: {
      content: { type: "image" },
      x: { type: "number" },
      y: { type: "number" },
    },
    outputs: { image: { type: "image" } },
  },
  canvas: {
    params: { width: 640, height: 480 },
    inputs: { content: { type: "image" } },
    outputs: { image: { type: "image" } },
  },
  over: {
    params: {},
    inputs: { bottom: { type: "image" }, top: { type: "image" } },
    outputs: { image: { type: "image" } },
  },
};
const host: LanguageHost = {
  aliases: {
    number: "number",
    expression: "expr",
    rect: "rect",
    layer: "layer",
    canvas: "canvas",
    over: "over",
  },
  info: (t) => {
    if (!Object.hasOwn(specs, t)) throw new Error("Unknown node");
    return specs[t]!;
  },
  normalize: (t, p) => ({ ...specs[t]!.params, ...p }) as never,
  numberType: "number",
  expressionType: "expr",
  composite: { type: "over", bottom: "bottom", top: "top" },
};
describe("safe OpenSCAD-style source", () => {
  test("parameter dependencies are nodes/edges, not baked literals", () => {
    const r = compile(
      'param size = 20; canvas(id="canvas") { layer(id="a") { rect(id="box", width=size * 2, height=size); } }',
      host,
    );
    expect(r.graph.nodes.find((n) => n.id === "size")?.params.value).toBe(20);
    expect(r.graph.nodes.some((n) => n.type === "expr")).toBe(true);
    expect(
      r.graph.edges.some(
        (e) => e.source.nodeId === "size" && e.target.port === "height",
      ),
    ).toBe(true);
  });
  test("forward references and exact print/reparse including edge IDs", () => {
    const a = compile(
      'view = canvas(content=shape); shape = rect(id="r", width=123);',
      host,
    );
    const emitted = print(a.graph, host),
      b = compile(emitted.source, host);
    expect(b.graph).toEqual(a.graph);
    expect(emitted.source.trim().startsWith("{")).toBe(false);
  });
  test("module instances have live numeric input nodes and independent IDs", () => {
    const r = compile(
      'module badge(w=40) { rect(id="face", width=w, height=w * 2); } canvas(id="canvas") { badge(id="first", w=12); badge(id="second", w=30); }',
      host,
    );
    expect(
      r.graph.nodes.find((n) => n.id === "first/param:w")?.params.value,
    ).toBe(12);
    expect(
      r.graph.nodes.find((n) => n.id === "second/param:w")?.params.value,
    ).toBe(30);
    expect(r.graph.nodes.some((n) => n.id === "first/face")).toBe(true);
    expect(
      r.entries.find((e) => e.nodeId === "first/face")?.definition,
    ).toBeDefined();
  });
  test("loops expand with stable instance IDs and a strict budget", () => {
    const r = compile(
      'canvas(id="canvas") { for (i=[0:2]) { layer(x=i*20) { rect(width=10); } } }',
      host,
    );
    expect(r.graph.nodes.filter((n) => n.type === "rect")).toHaveLength(3);
    expect(() => compile("for(i=[0:50000]){rect();}", host)).toThrow(/limit/);
  });
  test("expression source cursor maps to corresponding node", () => {
    const code = "param size=5; r=rect(width=size*2);",
      r = compile(code, host);
    expect(sourceNodesAt(r.entries, code.indexOf("*"))).toContain(
      "r:width:expr",
    );
  });
  test("malformed code, cycles, host escape and recursion never execute", () => {
    for (const code of [
      "rect(width=);",
      "a=b; b=a;",
      'constructor("return process")();',
      "a=rect(); b=a.constructor;",
      "module m(x=1){m();} m();",
    ])
      expect(() => compile(code, host)).toThrow();
  });
  test("comments, arrays, strings and precedence parse without host eval", () => {
    expect(parse("// a\nr=rect(width=1+2*3);/*done*/").statements).toHaveLength(
      1,
    );
    expect(
      compile("r=rect(width=1+2*3);", host).graph.nodes[0]?.params.width,
    ).toBe(7);
    expect(() => compile("r=rect(width=1/0);", host)).toThrow(/finite/);
  });
});

test("bound parameters retain non-default literal fallbacks after code roundtrip", () => {
  const result = compile(
    "param size=10; r=rect(width=link(size.value, fallback=77));",
    host,
  );
  expect(result.graph.nodes.find((n) => n.id === "r")?.params.width).toBe(77);
  expect(compile(print(result.graph, host).source, host).graph).toEqual(
    result.graph,
  );
});
