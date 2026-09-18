import type { Data } from "./ast";
import type { Graph, LanguageHost, SourceResult } from "./model";
import { compile } from "./compiler";
function printValue(value: Data): string {
  if (Array.isArray(value)) return `[${value.map(printValue).join(", ")}]`;
  if (value !== null && typeof value === "object")
    throw new Error(
      "Object-valued parameters require a host-specific source adapter; never emit hidden JSON",
    );
  return JSON.stringify(value);
}
/** Canonical readable code is a projection of the graph; explicit edge IDs preserve native identity. */
export function print(graph: Graph, host: LanguageHost): SourceResult {
  const aliases = new Map(
    Object.entries(host.aliases).map(([name, type]) => [type, name]),
  );
  const names = new Map<string, string>(),
    used = new Set<string>();
  for (const node of graph.nodes) {
    let base = node.id.replace(/[^A-Za-z0-9_]/g, "_");
    if (!/^[A-Za-z_]/.test(base)) base = "n_" + base;
    if (
      ["module", "for", "param", "pi", "true", "false", "null"].includes(base)
    )
      base = "n_" + base;
    let name = base || "n",
      i = 2;
    while (used.has(name)) name = base + "_" + i++;
    used.add(name);
    names.set(node.id, name);
  }
  const incoming = new Map<string, Map<string, Graph["edges"][number]>>();
  for (const edge of graph.edges) {
    const ports = incoming.get(edge.target.nodeId) ?? new Map();
    ports.set(edge.target.port, edge);
    incoming.set(edge.target.nodeId, ports);
  }
  const lines = [
    "// vecli parametric source · live typed connections · no eval",
    "// Select a node or place the cursor in a call to follow it in the other view.",
    "",
  ];
  // Forward references are resolved lazily; ordinal node order makes formatting stable.
  for (const node of [...graph.nodes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const inputs = incoming.get(node.id) ?? new Map();
    const args: string[] = [`id = ${JSON.stringify(node.id)}`];
    for (const [name, value] of Object.entries(node.params).sort(([a], [b]) =>
      a < b ? -1 : 1,
    ))
      if (!inputs.has(name)) args.push(`${name} = ${printValue(value)}`);
    for (const [name, edge] of [...inputs].sort(([a], [b]) =>
      a < b ? -1 : 1,
    )) {
      const sourceName = names.get(edge.source.nodeId);
      if (!sourceName) throw new Error("Source graph has dangling edge");
      const fallback = Object.hasOwn(node.params, name)
        ? `, fallback = ${printValue(node.params[name]!)}`
        : "";
      args.push(
        `${name} = link(${sourceName}.${edge.source.port}, id = ${JSON.stringify(edge.id)}${fallback})`,
      );
    }
    if (node.muted) args.push("bypass = true");
    const alias = aliases.get(node.type),
      call = alias ?? "node";
    if (!alias) args.unshift(JSON.stringify(node.type));
    lines.push(
      `${names.get(node.id)} = ${call}(`,
      ...args.map((a, i) => "  " + a + (i < args.length - 1 ? "," : "")),
      ");",
      "",
    );
  }
  const code = lines.join("\n");
  const parsed = compile(code, host);
  return parsed;
}
