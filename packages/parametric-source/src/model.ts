import type { Data, Span } from "./ast";
export interface Node {
  id: string;
  type: string;
  params: Record<string, Data>;
  muted: boolean;
}
export interface Edge {
  id: string;
  source: { nodeId: string; port: string };
  target: { nodeId: string; port: string };
}
export interface Graph {
  schemaVersion: 1;
  nodes: Node[];
  edges: Edge[];
}
export interface TypeInfo {
  inputs: Record<string, { type: string }>;
  outputs: Record<string, { type: string }>;
  params: Record<string, unknown>;
}
export interface LanguageHost {
  aliases: Readonly<Record<string, string>>;
  info(type: string): TypeInfo;
  normalize(type: string, params: Record<string, Data>): Record<string, Data>;
  numberType: string;
  expressionType: string;
  composite?: { type: string; bottom: string; top: string };
}
export interface SourceEntry extends Span {
  nodeId: string;
  role: "node" | "expression" | "module-parameter";
  fields: Record<string, Span>;
  definition?: Span;
}
export interface SourceResult {
  graph: Graph;
  entries: SourceEntry[];
  source: string;
}
export function sourceNodesAt(
  entries: readonly SourceEntry[],
  offset: number,
): string[] {
  const matches = entries.filter((e) => offset >= e.from && offset <= e.to);
  if (!matches.length) return [];
  const smallest = Math.min(...matches.map((e) => e.to - e.from));
  return [
    ...new Set(
      matches.filter((e) => e.to - e.from === smallest).map((e) => e.nodeId),
    ),
  ];
}
