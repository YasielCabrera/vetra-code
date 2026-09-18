import { POWERHOUSE_DATABASE_SQL_MAX_LENGTH } from "@t3tools/contracts";

export class PowerhouseSqlRejectedError extends Error {
  constructor(message = "Only one read-only row-producing SQL statement is allowed.") {
    super(message);
    this.name = "PowerhouseSqlRejectedError";
  }
}

const ALLOWED_FIRST_KEYWORDS = new Set(["SELECT", "WITH", "VALUES", "TABLE"]);
const MUTATING_CTE_KEYWORDS = new Set(["INSERT", "UPDATE", "DELETE", "MERGE"]);

interface ScanResult {
  readonly tokens: ReadonlyArray<string>;
  readonly semicolons: ReadonlyArray<number>;
  readonly meaningfulAfter: (offset: number) => boolean;
}

const scanSql = (sql: string): ScanResult => {
  const tokens: string[] = [];
  const semicolons: number[] = [];
  const meaningfulOffsets: number[] = [];
  let index = 0;
  let blockCommentDepth = 0;

  while (index < sql.length) {
    const char = sql[index] ?? "";
    const next = sql[index + 1] ?? "";

    if (char === "-" && next === "-") {
      index += 2;
      while (index < sql.length && sql[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockCommentDepth = 1;
      index += 2;
      while (index < sql.length && blockCommentDepth > 0) {
        if (sql[index] === "/" && sql[index + 1] === "*") {
          blockCommentDepth += 1;
          index += 2;
        } else if (sql[index] === "*" && sql[index + 1] === "/") {
          blockCommentDepth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      continue;
    }
    if (char === "'") {
      meaningfulOffsets.push(index);
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
        } else if (sql[index] === "'") {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      continue;
    }
    if (char === '"') {
      meaningfulOffsets.push(index);
      index += 1;
      while (index < sql.length) {
        if (sql[index] === '"' && sql[index + 1] === '"') {
          index += 2;
        } else if (sql[index] === '"') {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      continue;
    }
    if (char === "$") {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(index))?.[0];
      if (tag !== undefined) {
        meaningfulOffsets.push(index);
        const end = sql.indexOf(tag, index + tag.length);
        index = end < 0 ? sql.length : end + tag.length;
        continue;
      }
    }
    if (char === ";") {
      semicolons.push(index);
      index += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      index += 1;
      while (index < sql.length && /[A-Za-z0-9_$]/.test(sql[index] ?? "")) index += 1;
      meaningfulOffsets.push(start);
      tokens.push(sql.slice(start, index).toUpperCase());
      continue;
    }
    if (!/\s/.test(char)) meaningfulOffsets.push(index);
    index += 1;
  }

  return {
    tokens,
    semicolons,
    meaningfulAfter: (offset) => meaningfulOffsets.some((candidate) => candidate > offset),
  };
};

/** Validate and normalize the intentionally narrow SQL-console surface. */
export function validatePowerhouseReadQuery(sql: string): string {
  const trimmed = sql.trim();
  if (
    trimmed.length === 0 ||
    Buffer.byteLength(trimmed, "utf8") > POWERHOUSE_DATABASE_SQL_MAX_LENGTH
  ) {
    throw new PowerhouseSqlRejectedError("The SQL query is empty or exceeds the 64 KiB limit.");
  }
  const scanned = scanSql(trimmed);
  const firstKeyword = scanned.tokens[0];
  if (firstKeyword === undefined || !ALLOWED_FIRST_KEYWORDS.has(firstKeyword)) {
    throw new PowerhouseSqlRejectedError();
  }
  if (firstKeyword === "WITH" && scanned.tokens.some((token) => MUTATING_CTE_KEYWORDS.has(token))) {
    throw new PowerhouseSqlRejectedError("Data-changing common table expressions are not allowed.");
  }
  if (scanned.semicolons.length > 1) throw new PowerhouseSqlRejectedError();
  const semicolon = scanned.semicolons[0];
  if (semicolon !== undefined && scanned.meaningfulAfter(semicolon)) {
    throw new PowerhouseSqlRejectedError();
  }
  return semicolon === undefined ? trimmed : trimmed.slice(0, semicolon).trimEnd();
}

export function quotePowerhouseIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
