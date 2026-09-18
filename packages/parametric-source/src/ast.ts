export type Data =
  | null
  | boolean
  | number
  | string
  | Data[]
  | { [key: string]: Data };
export interface Span {
  from: number;
  to: number;
}
export interface Argument extends Span {
  name?: string;
  value: Expression;
}
export type Expression = Span &
  (
    | { kind: "literal"; value: Data }
    | { kind: "identifier"; name: string }
    | { kind: "member"; object: Expression; name: string }
    | { kind: "unary"; op: "+" | "-"; value: Expression }
    | {
        kind: "binary";
        op: "+" | "-" | "*" | "/" | "%";
        left: Expression;
        right: Expression;
      }
    | { kind: "array"; values: Expression[] }
    | { kind: "range"; first: Expression; last: Expression; step?: Expression }
    | {
        kind: "call";
        name: string;
        args: Argument[];
        children?: Statement[];
        close: number;
      }
  );
export type Statement = Span &
  (
    | { kind: "assign"; name: string; value: Expression; parameter: boolean }
    | { kind: "expression"; value: Expression }
    | { kind: "module"; name: string; params: Argument[]; body: Statement[] }
    | { kind: "for"; name: string; values: Expression; body: Statement[] }
  );
export interface Program {
  source: string;
  statements: Statement[];
}
export class SourceError extends Error {
  readonly line: number;
  readonly column: number;
  constructor(
    message: string,
    readonly span: Span,
    source: string,
  ) {
    const before = source.slice(0, span.from).split("\n");
    const line = before.length,
      column = before.at(-1)!.length + 1;
    super(`${message} (${line}:${column})`);
    this.name = "SourceError";
    this.line = line;
    this.column = column;
  }
}
