import { describe, expect, it } from "vite-plus/test";

import {
  PowerhouseSqlRejectedError,
  quotePowerhouseIdentifier,
  validatePowerhouseReadQuery,
} from "./powerhouseDatabaseSql.ts";

describe("validatePowerhouseReadQuery", () => {
  it.each([
    "SELECT * FROM public.items",
    "WITH values_cte AS (VALUES (1)) SELECT * FROM values_cte",
    "VALUES (1), (2)",
    "TABLE public.items",
    "-- inspect\nSELECT ';' AS semicolon",
    "SELECT $$not; another statement$$",
  ])("allows one row-producing statement: %s", (query) => {
    expect(validatePowerhouseReadQuery(query)).toBe(query.trim());
  });

  it("removes one final semicolon and trailing comments", () => {
    expect(validatePowerhouseReadQuery("SELECT 1; -- done")).toBe("SELECT 1");
  });

  it.each([
    "INSERT INTO items VALUES (1)",
    "UPDATE items SET value = 1",
    "DELETE FROM items",
    "CREATE TABLE items (id integer)",
    "DROP TABLE items",
    "COPY items TO STDOUT",
    "CALL do_work()",
    "DO $$ BEGIN END $$",
    "BEGIN",
    "SELECT 1; SELECT 2",
    "WITH deleted AS (DELETE FROM items RETURNING *) SELECT * FROM deleted",
  ])("rejects mutating, control, or multiple statements: %s", (query) => {
    expect(() => validatePowerhouseReadQuery(query)).toThrow(PowerhouseSqlRejectedError);
  });

  it("bounds SQL input", () => {
    expect(() => validatePowerhouseReadQuery(`SELECT '${"x".repeat(70_000)}'`)).toThrow(
      PowerhouseSqlRejectedError,
    );
  });
});

describe("quotePowerhouseIdentifier", () => {
  it("quotes generated relation SQL safely", () => {
    expect(quotePowerhouseIdentifier('read"model')).toBe('"read""model"');
  });
});
