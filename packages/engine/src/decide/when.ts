import type { DecisionContext } from "./types.js";

/** Literal types supported by the v1 condition language. */
type Literal = boolean | number | string;

/** Parsed condition AST: only comparisons, boolean logic, and value terminal nodes. */
export type Expression =
  | { type: "comparison"; left: ValueExpression; operator: "!=" | "=="; right: ValueExpression }
  | { type: "logical"; left: Expression; operator: "&&" | "||"; right: Expression }
  | { type: "not"; operand: Expression }
  | { type: "value"; value: ValueExpression };

/** Token stream produced by the lexer and consumed by the recursive-descent parser. */
type Token =
  | { type: "boolean"; value: boolean }
  | { type: "end" }
  | { type: "identifier"; value: string[] }
  | { type: "number"; value: number }
  | { type: "operator"; value: "!" | "!=" | "&&" | "==" | "||" }
  | { type: "parenthesis"; value: "(" | ")" }
  | { type: "string"; value: string };

/** Comparable operand: an inline literal or a dotted-path context value. */
type ValueExpression = { type: "literal"; value: Literal } | { type: "path"; value: string[] };

/** Internal sentinel for a missing or type-incompatible context value; surfaced as null-safe false. */
const missing = Symbol("missing decision context value");

/** Expression evaluation result; missing propagates through the tree to keep evaluation null-safe. */
type EvaluationResult = boolean | typeof missing;

/** Resolved operand value: a literal, an explicit null, or missing. */
type ResolvedValue = Literal | null | typeof missing;

/** Bounds expression nesting so pack text cannot overflow the call stack. */
const maxConditionDepth = 128;

export class ConditionSyntaxError extends Error {
  constructor() {
    super("The decision condition is invalid.");
    this.name = "ConditionSyntaxError";
  }
}

/** Parse the v1 condition language; parsing never executes pack-provided code. */
export function parseCondition(source: string): Expression {
  return new Parser(source).parse();
}

/** Evaluate an already-parsed v1 condition; missing fields resolve to false. */
export function evaluateParsedCondition(expression: Expression, context: DecisionContext): boolean {
  const result = evaluateExpression(expression, context);
  return result === missing ? false : result;
}

/** Parse and evaluate a v1 condition; parsing never executes pack-provided code. */
export function evaluateCondition(source: string, context: DecisionContext): boolean {
  return evaluateParsedCondition(parseCondition(source), context);
}

/**
 * Recursive-descent parser for the v1 condition language. Grammar:
 * or → and → unary → primary → value. It never executes pack-provided
 * code and supports no function calls, regular expressions, or quantifiers.
 */
class Parser {
  #index = 0;
  #lookahead: Token | undefined;
  #depth = 0;

  constructor(readonly source: string) {}

  /** Parse the full input through EOF; trailing garbage triggers a syntax error. */
  parse(): Expression {
    const expression = this.parseOr();
    if (this.read().type !== "end") throw new ConditionSyntaxError();
    return expression;
  }

  // Lowest precedence: || is left-associative over and expressions.
  private parseOr(): Expression {
    let expression = this.parseAnd();
    while (this.matchOperator("||")) {
      expression = { left: expression, operator: "||", right: this.parseAnd(), type: "logical" };
    }
    return expression;
  }

  // && is left-associative over unary expressions.
  private parseAnd(): Expression {
    let expression = this.parseUnary();
    while (this.matchOperator("&&")) {
      expression = { left: expression, operator: "&&", right: this.parseUnary(), type: "logical" };
    }
    return expression;
  }

  // Prefix ! applies to a unary operand, so !!x and !(...) are both valid.
  private parseUnary(): Expression {
    if (this.matchOperator("!")) {
      return this.withinDepth(() => ({ operand: this.parseUnary(), type: "not" }));
    }
    return this.parsePrimary();
  }

  // A parenthesized subexpression, or a value with an optional == / != comparison.
  private parsePrimary(): Expression {
    if (this.matchParenthesis("(")) {
      return this.withinDepth(() => {
        const expression = this.parseOr();
        if (!this.matchParenthesis(")")) throw new ConditionSyntaxError();
        return expression;
      });
    }

    const left = this.parseValue();
    const token = this.peek();
    if (token.type !== "operator" || (token.value !== "==" && token.value !== "!=")) {
      return { type: "value", value: left };
    }

    this.read();
    return { left, operator: token.value, right: this.parseValue(), type: "comparison" };
  }

  // A value is either a literal or a dotted-path identifier.
  private parseValue(): ValueExpression {
    const token = this.read();
    switch (token.type) {
      case "boolean":
      case "number":
      case "string":
        return { type: "literal", value: token.value };
      case "identifier":
        return { type: "path", value: token.value };
      default:
        throw new ConditionSyntaxError();
    }
  }

  private matchOperator(value: Extract<Token, { type: "operator" }>["value"]): boolean {
    const token = this.peek();
    if (token.type !== "operator" || token.value !== value) return false;
    this.read();
    return true;
  }

  private matchParenthesis(value: "(" | ")"): boolean {
    const token = this.peek();
    if (token.type !== "parenthesis" || token.value !== value) return false;
    this.read();
    return true;
  }

  private peek(): Token {
    this.#lookahead ??= this.nextToken();
    return this.#lookahead;
  }

  private read(): Token {
    const token = this.peek();
    this.#lookahead = undefined;
    return token;
  }

  // Dispatch on the first character: parenthesis / string / identifier / number, else operator.
  private nextToken(): Token {
    this.skipWhitespace();
    const character = this.source[this.#index];
    if (character === undefined) return { type: "end" };

    if (character === "(" || character === ")") {
      this.#index += 1;
      return { type: "parenthesis", value: character };
    }
    if (character === '"' || character === "'") return { type: "string", value: this.readString() };
    if (isIdentifierStart(character)) return this.readIdentifier();
    if (isNumberStart(character, this.source[this.#index + 1])) return this.readNumber();
    return this.readOperator();
  }

  // Parse a dotted path like a.b.c; a lone true/false is a boolean literal.
  private readIdentifier(): Token {
    const path: string[] = [];
    while (isIdentifierStart(this.source[this.#index])) {
      const start = this.#index;
      this.#index += 1;
      while (isIdentifierPart(this.source[this.#index])) this.#index += 1;
      path.push(this.source.slice(start, this.#index));
      if (this.source[this.#index] !== ".") break;
      this.#index += 1;
      if (!isIdentifierStart(this.source[this.#index])) throw new ConditionSyntaxError();
    }

    if (path.length === 1 && path[0] === "true") return { type: "boolean", value: true };
    if (path.length === 1 && path[0] === "false") return { type: "boolean", value: false };
    return { type: "identifier", value: path };
  }

  // JSON-style number: optional sign, fraction, and exponent parts.
  private readNumber(): Token {
    const start = this.#index;
    if (this.source[this.#index] === "-") this.#index += 1;
    this.consumeDigits();
    if (this.source[this.#index] === ".") {
      this.#index += 1;
      if (!isDigit(this.source[this.#index])) throw new ConditionSyntaxError();
      this.consumeDigits();
    }
    if (this.source[this.#index] === "e" || this.source[this.#index] === "E") {
      this.#index += 1;
      if (this.source[this.#index] === "+" || this.source[this.#index] === "-") this.#index += 1;
      if (!isDigit(this.source[this.#index])) throw new ConditionSyntaxError();
      this.consumeDigits();
    }
    return { type: "number", value: Number(this.source.slice(start, this.#index)) };
  }

  private consumeDigits(): void {
    while (isDigit(this.source[this.#index])) this.#index += 1;
  }

  // JSON-style string: simple escapes plus \uXXXX code points.
  private readString(): string {
    const quote = this.source[this.#index]!;
    let value = "";
    this.#index += 1;

    for (;;) {
      const character = this.source[this.#index];
      if (character === undefined) throw new ConditionSyntaxError();
      this.#index += 1;
      if (character === quote) return value;
      if (character !== "\\") {
        value += character;
        continue;
      }

      const escaped = this.source[this.#index];
      if (escaped === undefined) throw new ConditionSyntaxError();
      this.#index += 1;
      const simpleEscape = simpleEscapes[escaped];
      if (simpleEscape !== undefined) {
        value += simpleEscape;
        continue;
      }
      if (escaped !== "u") throw new ConditionSyntaxError();
      const codePoint = this.source.slice(this.#index, this.#index + 4);
      if (!/^[0-9a-fA-F]{4}$/.test(codePoint)) throw new ConditionSyntaxError();
      value += String.fromCharCode(Number.parseInt(codePoint, 16));
      this.#index += 4;
    }
  }

  // Prefer two-character operators (&& || == !=), then a single !.
  private readOperator(): Token {
    const operator = this.source.slice(this.#index, this.#index + 2);
    if (operator === "&&" || operator === "||" || operator === "==" || operator === "!=") {
      this.#index += 2;
      return { type: "operator", value: operator };
    }
    if (this.source[this.#index] === "!") {
      this.#index += 1;
      return { type: "operator", value: "!" };
    }
    throw new ConditionSyntaxError();
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.source[this.#index] ?? "")) this.#index += 1;
  }

  private withinDepth<T>(parse: () => T): T {
    // Count nesting from parentheses and unary operations; restore on exit so siblings share the budget.
    this.#depth += 1;
    if (this.#depth > maxConditionDepth) {
      this.#depth -= 1;
      throw new ConditionSyntaxError();
    }
    try {
      return parse();
    } finally {
      this.#depth -= 1;
    }
  }
}

/** Simple escape table shared by single- and double-quoted strings. */
const simpleEscapes: Readonly<Record<string, string>> = {
  '"': '"',
  "'": "'",
  "/": "/",
  "\\": "\\",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

/** Evaluate an AST node; missing propagates and evaluateParsedCondition resolves it to false. */
function evaluateExpression(expression: Expression, context: DecisionContext): EvaluationResult {
  switch (expression.type) {
    case "comparison":
      return evaluateComparison(expression, context);
    case "logical": {
      const left = toBoolean(evaluateExpression(expression.left, context));
      const right = toBoolean(evaluateExpression(expression.right, context));
      return expression.operator === "&&" ? left && right : left || right;
    }
    case "not": {
      const operand = evaluateExpression(expression.operand, context);
      return operand === missing ? missing : !operand;
    }
    case "value": {
      const value = resolveValue(expression.value, context);
      return typeof value === "boolean" ? value : missing;
    }
  }
}

/** Compare resolved operands for == / !=; missing or null operands never match. */
function evaluateComparison(
  expression: Extract<Expression, { type: "comparison" }>,
  context: DecisionContext,
): boolean {
  const left = resolveValue(expression.left, context);
  const right = resolveValue(expression.right, context);
  if (left === missing || right === missing || left === null || right === null) return false;
  if (typeof left !== typeof right) return false;
  const equal = left === right;
  return expression.operator === "==" ? equal : !equal;
}

/** Resolve a dotted path against the context; a missing segment or unsupported type yields missing. */
function resolveValue(value: ValueExpression, context: DecisionContext): ResolvedValue {
  if (value.type === "literal") return value.value;

  let current: unknown = context;
  for (const segment of value.value) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return missing;
    current = current[segment];
  }
  return typeof current === "boolean" || typeof current === "number" || typeof current === "string"
    ? current
    : current === null
      ? null
      : missing;
}

function toBoolean(value: EvaluationResult): boolean {
  return value === missing ? false : value;
}

function isDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "0" && value <= "9";
}

function isIdentifierPart(value: string | undefined): boolean {
  return value !== undefined && (isIdentifierStart(value) || isDigit(value));
}

function isIdentifierStart(value: string | undefined): boolean {
  return (
    value !== undefined &&
    ((value >= "a" && value <= "z") || (value >= "A" && value <= "Z") || value === "_")
  );
}

function isNumberStart(value: string, next: string | undefined): boolean {
  return isDigit(value) || (value === "-" && isDigit(next));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
