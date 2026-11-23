import { test } from "node:test";
import assert from "node:assert/strict";
import { formatearEuros } from "../vendor/importes/index.ts";

test("los importes se muestran siempre con dos decimales", () => {
  assert.equal(formatearEuros(1050), "10,50 €");
  assert.equal(formatearEuros(1000), "10,00 €");
  assert.equal(formatearEuros(5), "0,05 €");
});
