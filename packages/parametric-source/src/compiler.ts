import {
  SourceError,
  type Argument,
  type Data,
  type Expression,
  type Program,
  type Span,
  type Statement,
} from "./ast";
import { parse } from "./parser";
import type {
  Edge,
  Graph,
  LanguageHost,
  Node,
  SourceEntry,
  SourceResult,
} from "./model";
type Literal = { tag: "literal"; value: Data };
type Reference = {
  tag: "reference";
  nodeId: string;
  port: string;
  edgeId?: string;
  fallback?: Data;
};
type Value = Literal | Reference;
interface Scope {
  parent?: Scope;
  values: Map<string, Value>;
  assignments: Map<string, Extract<Statement, { kind: "assign" }>>;
  modules: Map<string, Extract<Statement, { kind: "module" }>>;
  resolving: Set<string>;
  prefix: string;
  instance?: Span;
}
const literal = (value: Data): Literal => ({ tag: "literal", value });
export function compile(source: string, host: LanguageHost): SourceResult {
  const program: Program = parse(source),
    graph: Graph = { schemaVersion: 1, nodes: [], edges: [] },
    entries: SourceEntry[] = [];
  const nodes = new Map<string, Node>(),
    edgeIds = new Set<string>(),
    occupiedInputs = new Set<string>();
  let steps = 0,
    moduleDepth = 0;
  const error = (message: string, span: Span): never => {
    throw new SourceError(message, span, source);
  };
  const budget = (span: Span) => {
    if (++steps > 50_000) error("Expansion budget exceeded", span);
  };
  function scope(
    body: Statement[],
    parent?: Scope,
    prefix = "",
    instance?: Span,
  ): Scope {
    const current: Scope = {
      values: new Map(),
      assignments: new Map(),
      modules: new Map(),
      resolving: new Set(),
      prefix,
      ...(parent ? { parent } : {}),
      ...(instance ? { instance } : {}),
    };
    for (const statement of body) {
      if (statement.kind !== "assign" && statement.kind !== "module") continue;
      if (
        current.assignments.has(statement.name) ||
        current.modules.has(statement.name)
      )
        error(`Duplicate declaration '${statement.name}'`, statement);
      if (statement.kind === "assign")
        current.assignments.set(statement.name, statement);
      else current.modules.set(statement.name, statement);
    }
    return current;
  }
  function add(
    type: string,
    id: string,
    params: Record<string, Data>,
    span: Span,
    current: Scope,
    fields: Record<string, Span> = {},
    role: SourceEntry["role"] = "node",
  ): Reference {
    if (!id || id.length > 160 || /[\u0000-\u001f]/.test(id))
      error("Node ID must be 1–160 printable characters", span);
    if (nodes.has(id)) error(`Duplicate semantic ID '${id}'`, span);
    if (nodes.size >= 4096) error("Expanded graph exceeds 4096 nodes", span);
    let node: Node;
    try {
      node = { id, type, params: host.normalize(type, params), muted: false };
    } catch (e) {
      return error(e instanceof Error ? e.message : String(e), span);
    }
    nodes.set(id, node);
    graph.nodes.push(node);
    entries.push({
      nodeId: id,
      role,
      from: current.instance?.from ?? span.from,
      to: current.instance?.to ?? span.to,
      fields,
      ...(current.instance ? { definition: span } : {}),
    });
    const output = Object.keys(host.info(type).outputs)[0];
    if (!output) error(`Node '${type}' has no output`, span);
    return { tag: "reference", nodeId: id, port: output! };
  }
  function connect(
    reference: Reference,
    target: string,
    port: string,
    span: Span,
  ): void {
    const origin = nodes.get(reference.nodeId),
      destination = nodes.get(target);
    if (!origin || !destination)
      error("Connection references an unknown node", span);
    const input = host.info(destination!.type).inputs[port],
      output = host.info(origin!.type).outputs[reference.port];
    if (
      !Object.hasOwn(host.info(destination!.type).inputs, port) ||
      !input ||
      !Object.hasOwn(host.info(origin!.type).outputs, reference.port) ||
      !output ||
      input.type !== output.type
    )
      error(`Incompatible connection to ${target}.${port}`, span);
    const inputKey = JSON.stringify([target, port]);
    if (occupiedInputs.has(inputKey))
      error(`Input ${target}.${port} is already connected`, span);
    const id = reference.edgeId ?? `input:${target}:${port}`;
    if (id.length > 160 || edgeIds.has(id))
      error(`Invalid or duplicate edge ID '${id}'`, span);
    if (graph.edges.length >= 16384)
      error("Expanded graph exceeds edge budget", span);
    occupiedInputs.add(inputKey);
    edgeIds.add(id);
    graph.edges.push({
      id,
      source: { nodeId: reference.nodeId, port: reference.port },
      target: { nodeId: target, port },
    });
  }
  function lookup(name: string, current: Scope, at: Span): Value {
    for (
      let candidate: Scope | undefined = current;
      candidate;
      candidate = candidate.parent
    ) {
      if (candidate.values.has(name)) return candidate.values.get(name)!;
      const declaration = candidate.assignments.get(name);
      if (!declaration) continue;
      if (candidate.resolving.has(name))
        return error(`Cyclic reference '${name}'`, at);
      candidate.resolving.add(name);
      const value = evaluate(declaration.value, candidate, name);
      let resolved = value;
      if (declaration.parameter) {
        if (value.tag !== "literal" || typeof value.value !== "number")
          return error(
            "param declarations currently require a constant number; use an expression node for derived parameters",
            declaration,
          );
        resolved = add(
          host.numberType,
          candidate.prefix + name,
          { value: value.value },
          declaration,
          candidate,
          { value: declaration.value },
        );
      }
      candidate.values.set(name, resolved);
      candidate.resolving.delete(name);
      return resolved;
    }
    if (name === "pi") return literal(Math.PI);
    return error(`Unknown identifier '${name}'`, at);
  }
  function constant(value: Value, span: Span): Data {
    if (value.tag !== "literal")
      return error("Constant data expected here", span);
    return value.value;
  }
  function numeric(value: Value, span: Span): number {
    const data = constant(value, span);
    if (typeof data !== "number" || !Number.isFinite(data))
      return error("Finite number expected", span);
    return data;
  }
  function argsMap(args: Argument[]): Map<string, Argument> {
    const map = new Map<string, Argument>();
    let index = 0;
    for (const a of args) {
      const key = a.name ?? `$${index++}`;
      if (map.has(key)) error(`Duplicate argument '${key}'`, a);
      map.set(key, a);
    }
    return map;
  }
  function compose(
    values: Reference[],
    current: Scope,
    hint: string,
    span: Span,
  ): Reference {
    if (!values.length)
      return error("A module/block must produce a node", span);
    let result = values[0]!;
    for (let i = 1; i < values.length; i++) {
      if (!host.composite)
        return error("Multiple children require a composition adapter", span);
      const mix = add(
        host.composite!.type,
        `${current.prefix}${hint}:compose:${i}`,
        {},
        span,
        current,
      );
      connect(result, mix.nodeId, host.composite!.bottom, span);
      connect(values[i]!, mix.nodeId, host.composite!.top, span);
      result = mix;
    }
    return result;
  }
  function call(
    expr: Extract<Expression, { kind: "call" }>,
    current: Scope,
    hint: string,
  ): Value {
    const args = argsMap(expr.args);
    if (expr.name === "link") {
      const sourceArg = args.get("$0") ?? args.get("source"),
        idArg = args.get("id");
      if (
        !sourceArg ||
        [...args.keys()].some(
          (k) => !["$0", "source", "id", "fallback"].includes(k),
        ) ||
        (args.has("$0") && args.has("source"))
      )
        return error("link(source, id=...) expected", expr);
      const value = evaluate(sourceArg.value, current, hint + ":link");
      if (value.tag !== "reference")
        return error("link requires a node output", sourceArg);
      const fallbackArg = args.get("fallback");
      const fallback = fallbackArg
        ? {
            fallback: constant(
              evaluate(fallbackArg.value, current, hint + ":fallback"),
              fallbackArg,
            ),
          }
        : {};
      if (!idArg) return { ...value, ...fallback };
      const id = constant(
        evaluate(idArg.value, current, hint + ":edge"),
        idArg,
      );
      if (typeof id !== "string")
        return error("Edge ID must be a string", idArg);
      return { ...value, ...fallback, edgeId: current.prefix + id };
    }
    let definition: Extract<Statement, { kind: "module" }> | undefined,
      declarationScope: Scope | undefined;
    for (let s: Scope | undefined = current; s; s = s.parent) {
      definition = s.modules.get(expr.name);
      if (definition) {
        declarationScope = s;
        break;
      }
    }
    if (definition) {
      if (++moduleDepth > 16)
        return error("Module recursion/depth budget exceeded", expr);
      try {
        const suppliedId = args.get("id");
        const idData = suppliedId
          ? constant(
              evaluate(suppliedId.value, current, hint + ":id"),
              suppliedId,
            )
          : hint;
        if (typeof idData !== "string")
          return error("Module instance ID must be a string", expr);
        const child = scope(
          definition.body,
          declarationScope,
          current.prefix + idData + "/",
          expr,
        );
        const accepted = new Set(["id"]);
        for (const [index, p] of definition.params.entries()) {
          const key = p.name!;
          const named = args.get(key),
            positional = args.get(`$${index}`);
          if (named && positional)
            return error(`Argument '${key}' is duplicated positionally`, expr);
          const provided = named ?? positional,
            origin = provided?.value ?? p.value;
          const value = evaluate(
            origin,
            provided ? current : declarationScope!,
            `${idData}:arg:${key}`,
          );
          accepted.add(key);
          accepted.add(`$${index}`);
          if (value.tag === "literal" && typeof value.value === "number") {
            // Instance inputs are live scalar nodes, not baked constants inside the expanded geometry.
            const field: Record<string, Span> = provided ? { value: provided.value } : {};
            child.values.set(
              key,
              add(
                host.numberType,
                `${child.prefix}param:${key}`,
                { value: value.value },
                provided ?? expr,
                child,
                field,
                "module-parameter",
              ),
            );
          } else child.values.set(key, value);
        }
        for (const name of args.keys())
          if (!accepted.has(name))
            return error(`Unknown module argument '${name}'`, expr);
        const outputs = run(definition.body, child);
        return compose(outputs, child, "output", expr);
      } finally {
        moduleDepth--;
      }
    }
    let type: string;
    if (expr.name === "node") {
      const arg = args.get("$0") ?? args.get("type");
      if (!arg) return error('node("type", ...) requires a type', expr);
      const data = constant(evaluate(arg.value, current, hint + ":type"), arg);
      if (typeof data !== "string")
        return error("Node type must be a string", arg);
      type = data;
      args.delete(arg.name ?? "$0");
    } else {
      if (!Object.hasOwn(host.aliases, expr.name))
        return error(`Unknown node or module '${expr.name}'`, expr);
      type = host.aliases[expr.name]!;
    }
    const info = host.info(type),
      idArg = args.get("id");
    const idData = idArg
      ? constant(evaluate(idArg.value, current, hint + ":id"), idArg)
      : hint;
    if (typeof idData !== "string")
      return error("Node ID must be a string", expr);
    const id = current.prefix + idData,
      params: Record<string, Data> = Object.create(null),
      bindings: Array<{ port: string; ref: Reference; span: Span }> = [],
      fields: Record<string, Span> = Object.create(null);
    let muted = false;
    for (const [key, arg] of args) {
      if (key === "id") continue;
      const value = evaluate(arg.value, current, `${idData}:${key}`);
      if (key === "bypass") {
        const flag = constant(value, arg);
        if (typeof flag !== "boolean")
          return error("bypass must be boolean", arg);
        muted = flag;
        continue;
      }
      if (value.tag === "reference") {
        if (!Object.hasOwn(info.inputs, key))
          return error(`'${key}' is not a typed input on ${type}`, arg);
        if (Object.hasOwn(value, "fallback")) {
          if (!Object.hasOwn(info.params, key))
            return error("Only parameter bindings have literal fallbacks", arg);
          params[key] = value.fallback!;
        }
        bindings.push({ port: key, ref: value, span: arg });
      } else {
        if (!Object.hasOwn(info.params, key))
          return error(`Unknown parameter '${key}' on ${type}`, arg);
        params[key] = value.value;
        if (arg.value.kind === "literal" || arg.value.kind === "array")
          fields[key] = arg.value;
      }
    }
    const result = add(type, id, params, expr, current, fields);
    nodes.get(id)!.muted = muted;
    for (const binding of bindings)
      connect(binding.ref, id, binding.port, binding.span);
    if (expr.children) {
      const childScope = scope(
          expr.children,
          current,
          current.prefix,
          current.instance,
        ),
        children = run(expr.children, childScope);
      if (children.length) {
        const port = Object.hasOwn(info.inputs, "content")
          ? "content"
          : Object.hasOwn(info.inputs, "input")
            ? "input"
            : undefined;
        if (!port) return error(`${type} cannot contain child nodes`, expr);
        connect(compose(children, current, idData, expr), id, port, expr);
      }
    }
    return result;
  }
  let evaluationDepth = 0;
  function evaluate(expr: Expression, current: Scope, hint: string): Value {
    if (++evaluationDepth > 96) {
      evaluationDepth--;
      return error("Expression evaluation nesting limit", expr);
    }
    try {
      return evaluateExpression(expr, current, hint);
    } finally {
      evaluationDepth--;
    }
  }
  function evaluateExpression(
    expr: Expression,
    current: Scope,
    hint: string,
  ): Value {
    budget(expr);
    switch (expr.kind) {
      case "literal":
        return literal(expr.value);
      case "identifier":
        return lookup(expr.name, current, expr);
      case "member": {
        const value = evaluate(expr.object, current, hint);
        if (value.tag !== "reference")
          return error("Only node output ports can be accessed", expr);
        const n = nodes.get(value.nodeId)!;
        if (!Object.hasOwn(host.info(n.type).outputs, expr.name))
          return error("Unknown output port", expr);
        return { ...value, port: expr.name };
      }
      case "array":
        return literal(
          expr.values.map((v, i) =>
            constant(evaluate(v, current, `${hint}:${i}`), v),
          ),
        );
      case "range": {
        const start = numeric(
            evaluate(expr.first, current, hint + ":start"),
            expr,
          ),
          end = numeric(evaluate(expr.last, current, hint + ":end"), expr),
          step = expr.step
            ? numeric(evaluate(expr.step, current, hint + ":step"), expr)
            : 1;
        if (step === 0 || (end - start) / step < 0)
          return error("Range step must reach its endpoint", expr);
        const length = Math.floor((end - start) / step) + 1;
        if (length > 256) return error("Range expansion limit is 256", expr);
        return literal(Array.from({ length }, (_, i) => start + i * step));
      }
      case "call":
        return call(expr, current, hint);
      case "unary": {
        const value = evaluate(expr.value, current, hint + ":operand");
        if (value.tag === "literal")
          return literal(
            expr.op === "-" ? -numeric(value, expr) : numeric(value, expr),
          );
        if (expr.op === "+") return value;
        const ref = add(
          host.expressionType,
          current.prefix + hint + ":expr",
          { expression: "-a" },
          expr,
          current,
        );
        connect(value, ref.nodeId, "a", expr);
        return ref;
      }
      case "binary": {
        const left = evaluate(expr.left, current, hint + ":left"),
          right = evaluate(expr.right, current, hint + ":right");
        if (left.tag === "literal" && right.tag === "literal") {
          if (
            expr.op === "+" &&
            typeof left.value === "string" &&
            typeof right.value === "string"
          ) {
            const text = left.value + right.value;
            if (text.length > 100000)
              return error("String budget exceeded", expr);
            return literal(text);
          }
          const a = numeric(left, expr.left),
            b = numeric(right, expr.right);
          let value: number;
          switch (expr.op) {
            case "+":
              value = a + b;
              break;
            case "-":
              value = a - b;
              break;
            case "*":
              value = a * b;
              break;
            case "/":
              value = a / b;
              break;
            case "%":
              value = a % b;
              break;
          }
          if (!Number.isFinite(value) || Math.abs(value) > 1e12)
            return error("Arithmetic result must be finite and bounded", expr);
          return literal(value);
        }
        const params: Record<string, Data> = { expression: `a ${expr.op} b` };
        if (left.tag === "literal") params.a = numeric(left, expr.left);
        if (right.tag === "literal") params.b = numeric(right, expr.right);
        const ref = add(
          host.expressionType,
          current.prefix + hint + ":expr",
          params,
          expr,
          current,
        );
        if (left.tag === "reference") connect(left, ref.nodeId, "a", expr.left);
        if (right.tag === "reference")
          connect(right, ref.nodeId, "b", expr.right);
        return ref;
      }
    }
  }
  function run(statements: Statement[], current: Scope): Reference[] {
    const outputs: Reference[] = [];
    for (const [index, statement] of statements.entries()) {
      budget(statement);
      if (statement.kind === "module") continue;
      if (statement.kind === "assign") {
        lookup(statement.name, current, statement);
        continue;
      }
      if (statement.kind === "for") {
        const values = constant(
          evaluate(statement.values, current, `range${index}`),
          statement.values,
        );
        if (!Array.isArray(values) || values.length > 256)
          return error("for requires a bounded array/range", statement);
        for (const [i, value] of values.entries()) {
          const child = scope(
            statement.body,
            current,
            `${current.prefix}loop${index}/${i}/`,
            current.instance,
          );
          child.values.set(statement.name, literal(value));
          outputs.push(...run(statement.body, child));
        }
      } else {
        const result = evaluate(
          statement.value,
          current,
          statement.value.kind === "call"
            ? `${statement.value.name}${index}`
            : `value${index}`,
        );
        if (result.tag === "reference") outputs.push(result);
      }
    }
    return outputs;
  }
  run(program.statements, scope(program.statements));
  graph.nodes.sort((a, b) => (a.id < b.id ? -1 : 1));
  graph.edges.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { graph, entries, source };
}
