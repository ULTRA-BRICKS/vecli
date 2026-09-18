import {
  SourceError,
  type Argument,
  type Expression,
  type Program,
  type Span,
  type Statement,
} from "./ast";
interface Token extends Span {
  text: string;
  kind: "id" | "number" | "string" | "symbol" | "eof";
}
function tokenize(source: string): Token[] {
  if (source.length > 1_048_576)
    throw new SourceError(
      "Source exceeds 1 MiB character limit",
      { from: 0, to: 1 },
      source,
    );
  const tokens: Token[] = [];
  let offset = 0;
  const whitespacePattern = /\s+/y,
    numberPattern = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y,
    idPattern = /[A-Za-z_$][A-Za-z0-9_$]*/y;
  const match = (pattern: RegExp) => {
    pattern.lastIndex = offset;
    return pattern.exec(source);
  };
  while (offset < source.length) {
    const from = offset;
    const whitespace = match(whitespacePattern);
    if (whitespace) {
      offset += whitespace[0].length;
      continue;
    }
    if (source.startsWith("//", offset)) {
      const end = source.indexOf("\n", offset);
      offset = end < 0 ? source.length : end;
      continue;
    }
    if (source.startsWith("/*", offset)) {
      const end = source.indexOf("*/", offset + 2);
      if (end < 0)
        throw new SourceError(
          "Unclosed comment",
          { from, to: from + 2 },
          source,
        );
      offset = end + 2;
      continue;
    }
    let text: string, kind: Token["kind"];
    if (source[offset] === '"') {
      let end = offset + 1;
      while (end < source.length && source[end] !== '"') {
        if (source[end] === "\\") end++;
        end++;
      }
      if (end >= source.length)
        throw new SourceError(
          "Unclosed string",
          { from, to: source.length },
          source,
        );
      text = source.slice(offset, end + 1);
      kind = "string";
      try {
        JSON.parse(text);
      } catch {
        throw new SourceError(
          "Invalid string escape",
          { from, to: end + 1 },
          source,
        );
      }
    } else {
      const number = match(numberPattern);
      const id = match(idPattern);
      if (number) {
        text = number[0];
        kind = "number";
      } else if (id) {
        text = id[0];
        kind = "id";
      } else if ("(){}[];,:.=+-*/%".includes(source[offset]!)) {
        text = source[offset]!;
        kind = "symbol";
      } else
        throw new SourceError(
          "Unexpected character",
          { from, to: from + 1 },
          source,
        );
    }
    offset += text.length;
    tokens.push({ text, kind, from, to: offset });
    if (tokens.length > 50_000)
      throw new SourceError(
        "Token budget exceeded",
        { from, to: offset },
        source,
      );
  }
  tokens.push({
    text: "",
    kind: "eof",
    from: source.length,
    to: source.length,
  });
  return tokens;
}
export function parse(source: string): Program {
  const tokens = tokenize(source);
  let position = 0,
    depth = 0;
  const peek = (shift = 0) =>
    tokens[Math.min(position + shift, tokens.length - 1)]!;
  const fail = (message: string): never => {
    throw new SourceError(message, peek(), source);
  };
  const take = (text: string): Token => {
    if (peek().text !== text) fail(`Expected '${text}'`);
    return tokens[position++]!;
  };
  const name = (): Token => {
    if (peek().kind !== "id") fail("Expected identifier");
    return tokens[position++]!;
  };
  function nested<T>(fn: () => T): T {
    if (++depth > 64) fail("Nesting budget exceeded");
    try {
      return fn();
    } finally {
      depth--;
    }
  }
  function args(): { args: Argument[]; close: number } {
    take("(");
    const result: Argument[] = [];
    while (peek().text !== ")") {
      const from = peek().from;
      let key: string | undefined;
      if (peek().kind === "id" && peek(1).text === "=") {
        key = name().text;
        take("=");
      }
      const value = expression();
      result.push({ from, to: value.to, value, ...(key ? { name: key } : {}) });
      if (peek().text !== ",") break;
      take(",");
    }
    return { args: result, close: take(")").from };
  }
  function primary(): Expression {
    return nested(() => {
      const t = peek();
      position++;
      let value: Expression;
      if (t.kind === "number") {
        const n = Number(t.text);
        if (!Number.isFinite(n))
          throw new SourceError("Number must be finite", t, source);
        value = { kind: "literal", value: n, from: t.from, to: t.to };
      } else if (t.kind === "string")
        value = {
          kind: "literal",
          value: JSON.parse(t.text) as string,
          from: t.from,
          to: t.to,
        };
      else if (t.text === "+" || t.text === "-") {
        const v = primary();
        return { kind: "unary", op: t.text, value: v, from: t.from, to: v.to };
      } else if (t.text === "(") {
        value = expression();
        take(")");
      } else if (t.text === "[") {
        if (peek().text === "]") {
          const end = take("]");
          return { kind: "array", values: [], from: t.from, to: end.to };
        }
        const first = expression();
        if (peek().text === ":") {
          take(":");
          let last = expression(),
            step: Expression | undefined;
          if (peek().text === ":") {
            take(":");
            step = last;
            last = expression();
          }
          return {
            kind: "range",
            first,
            last,
            ...(step ? { step } : {}),
            from: t.from,
            to: take("]").to,
          };
        }
        const values = [first];
        while (peek().text === ",") {
          take(",");
          if (peek().text === "]") break;
          values.push(expression());
        }
        return { kind: "array", values, from: t.from, to: take("]").to };
      } else if (t.kind === "id") {
        if (["true", "false", "null"].includes(t.text))
          value = {
            kind: "literal",
            value: t.text === "null" ? null : t.text === "true",
            from: t.from,
            to: t.to,
          };
        else if (peek().text === "(") {
          const a = args();
          value = {
            kind: "call",
            name: t.text,
            ...a,
            from: t.from,
            to: a.close + 1,
          };
        } else
          value = { kind: "identifier", name: t.text, from: t.from, to: t.to };
      } else
        throw new SourceError(
          "Expected literal, reference, or call",
          t,
          source,
        );
      if (peek().text === ".") {
        take(".");
        const port = name();
        value = {
          kind: "member",
          object: value,
          name: port.text,
          from: value.from,
          to: port.to,
        };
      }
      return value;
    });
  }
  const precedence: Record<string, number> = {
    "+": 1,
    "-": 1,
    "*": 2,
    "/": 2,
    "%": 2,
  };
  function expression(minimum = 0): Expression {
    let value = primary();
    while (
      Object.hasOwn(precedence, peek().text) &&
      precedence[peek().text]! >= minimum
    ) {
      const op = tokens[position++]!,
        right = nested(() => expression(precedence[op.text]! + 1));
      value = {
        kind: "binary",
        op: op.text as "+" | "-" | "*" | "/" | "%",
        left: value,
        right,
        from: value.from,
        to: right.to,
      };
    }
    return value;
  }
  function block(): Statement[] {
    take("{");
    const body: Statement[] = [];
    while (peek().text !== "}") {
      if (peek().kind === "eof") fail("Unclosed block");
      body.push(nested(statement));
    }
    take("}");
    return body;
  }
  function statement(): Statement {
    const from = peek().from;
    if (peek().text === "module") {
      take("module");
      const id = name(),
        a = args();
      for (const arg of a.args)
        if (!arg.name)
          throw new SourceError(
            "Module parameters need names and defaults",
            arg,
            source,
          );
      const body = block();
      return {
        kind: "module",
        name: id.text,
        params: a.args,
        body,
        from,
        to: tokens[position - 1]!.to,
      };
    }
    if (peek().text === "for") {
      take("for");
      take("(");
      const id = name();
      take("=");
      const values = expression();
      take(")");
      const body = block();
      return {
        kind: "for",
        name: id.text,
        values,
        body,
        from,
        to: tokens[position - 1]!.to,
      };
    }
    const parameter = peek().text === "param";
    if (parameter) take("param");
    if (parameter || (peek().kind === "id" && peek(1).text === "=")) {
      const id = name();
      take("=");
      const value = expression();
      take(";");
      return {
        kind: "assign",
        name: id.text,
        value,
        parameter,
        from,
        to: tokens[position - 1]!.to,
      };
    }
    let value = expression();
    if (peek().text === "{") {
      if (value.kind !== "call") fail("Only calls can own child blocks");
      const children = block();
      value = {
        ...value,
        children,
        to: tokens[position - 1]!.to,
      } as Expression;
      if (peek().text === ";") take(";");
    } else take(";");
    return { kind: "expression", value, from, to: tokens[position - 1]!.to };
  }
  const statements: Statement[] = [];
  while (peek().kind !== "eof") statements.push(nested(statement));
  return { source, statements };
}
