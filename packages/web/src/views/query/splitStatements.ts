/**
 * Split a buffer of SQL into individual statements, honoring Athena's
 * dialect-specific tokens so semicolons inside strings, comments, and
 * parenthesized clauses don't falsely split a statement.
 *
 * Each returned Statement records its `start` / `end` offset in the
 * original source (end is exclusive, and does not include the trailing
 * semicolon) so callers can map cursor positions back to statements.
 */

export interface Statement {
  text: string;
  start: number;
  end: number;
}

type State = "code" | "line_comment" | "block_comment" | "string" | "ident";

interface Ctx {
  sql: string;
  i: number;
  state: State;
  paren: number;
  stmtStart: number;
  hadCode: boolean;
  out: Statement[];
}

export function splitStatements(sql: string): Statement[] {
  const ctx: Ctx = {
    sql,
    i: 0,
    state: "code",
    paren: 0,
    stmtStart: 0,
    hadCode: false,
    out: [],
  };
  while (ctx.i < sql.length) {
    step(ctx);
  }
  flush(ctx, sql.length);
  return ctx.out;
}

function step(ctx: Ctx): void {
  switch (ctx.state) {
    case "code":
      return stepCode(ctx);
    case "line_comment":
      return stepLineComment(ctx);
    case "block_comment":
      return stepBlockComment(ctx);
    case "string":
      return stepString(ctx);
    case "ident":
      return stepIdent(ctx);
  }
}

function stepCode(ctx: Ctx): void {
  const ch = ctx.sql[ctx.i]!;
  const next = ctx.sql[ctx.i + 1];
  if (tryEnterComment(ctx, ch, next)) return;
  if (tryEnterQuoted(ctx, ch)) return;
  if (tryParenOrSemicolon(ctx, ch)) return;
  if (!/\s/.test(ch)) ctx.hadCode = true;
  ctx.i += 1;
}

function tryEnterComment(ctx: Ctx, ch: string, next: string | undefined): boolean {
  if (ch === "-" && next === "-") {
    enter(ctx, "line_comment", 2);
    return true;
  }
  if (ch === "/" && next === "*") {
    enter(ctx, "block_comment", 2);
    return true;
  }
  return false;
}

function tryEnterQuoted(ctx: Ctx, ch: string): boolean {
  if (ch === "'") {
    enterWithCode(ctx, "string", 1);
    return true;
  }
  if (ch === '"') {
    enterWithCode(ctx, "ident", 1);
    return true;
  }
  return false;
}

function tryParenOrSemicolon(ctx: Ctx, ch: string): boolean {
  if (ch === "(") {
    mark(ctx, () => (ctx.paren += 1));
    return true;
  }
  if (ch === ")") {
    mark(ctx, () => (ctx.paren = Math.max(0, ctx.paren - 1)));
    return true;
  }
  if (ch === ";" && ctx.paren === 0) {
    flush(ctx, ctx.i);
    ctx.stmtStart = ctx.i + 1;
    ctx.hadCode = false;
    ctx.i += 1;
    return true;
  }
  return false;
}

function stepLineComment(ctx: Ctx): void {
  if (ctx.sql[ctx.i] === "\n") ctx.state = "code";
  ctx.i += 1;
}

function stepBlockComment(ctx: Ctx): void {
  if (ctx.sql[ctx.i] === "*" && ctx.sql[ctx.i + 1] === "/") {
    ctx.state = "code";
    ctx.i += 2;
    return;
  }
  ctx.i += 1;
}

function stepString(ctx: Ctx): void {
  if (ctx.sql[ctx.i] === "'" && ctx.sql[ctx.i + 1] === "'") {
    ctx.i += 2;
    return;
  }
  if (ctx.sql[ctx.i] === "'") ctx.state = "code";
  ctx.i += 1;
}

function stepIdent(ctx: Ctx): void {
  if (ctx.sql[ctx.i] === '"' && ctx.sql[ctx.i + 1] === '"') {
    ctx.i += 2;
    return;
  }
  if (ctx.sql[ctx.i] === '"') ctx.state = "code";
  ctx.i += 1;
}

function enter(ctx: Ctx, state: State, advance: number): void {
  ctx.state = state;
  ctx.i += advance;
}

function enterWithCode(ctx: Ctx, state: State, advance: number): void {
  ctx.hadCode = true;
  enter(ctx, state, advance);
}

function mark(ctx: Ctx, mutate: () => void): void {
  mutate();
  ctx.hadCode = true;
  ctx.i += 1;
}

function flush(ctx: Ctx, endExclusive: number): void {
  if (!ctx.hadCode) return;
  const slice = ctx.sql.slice(ctx.stmtStart, endExclusive);
  const leading = slice.length - slice.trimStart().length;
  const trailing = slice.length - slice.trimEnd().length;
  ctx.out.push({
    text: slice.trim(),
    start: ctx.stmtStart + leading,
    end: endExclusive - trailing,
  });
}

/**
 * Given the cursor's character offset in the buffer, return the
 * statement that contains it. Falls back to the statement ending
 * closest-before the cursor (e.g. cursor sitting on the final `;`).
 */
export function statementAtOffset(
  statements: Statement[],
  offset: number
): Statement | null {
  if (statements.length === 0) return null;
  for (const s of statements) {
    if (offset >= s.start && offset <= s.end) return s;
  }
  let fallback: Statement | null = null;
  for (const s of statements) {
    if (s.end <= offset && (!fallback || s.end > fallback.end)) fallback = s;
  }
  return fallback ?? statements[0]!;
}
