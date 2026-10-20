import { test } from "node:test";
import assert from "node:assert/strict";
import { pgBudgetEnabled } from "../src/db/pgBudget.js";

test("postgres budget store stays off unless the flag is set", () => {
  const prev = process.env.BUDGET_STORE;
  delete process.env.BUDGET_STORE;
  assert.equal(pgBudgetEnabled(), false);
  if (prev == null) delete process.env.BUDGET_STORE;
  else process.env.BUDGET_STORE = prev;
});
