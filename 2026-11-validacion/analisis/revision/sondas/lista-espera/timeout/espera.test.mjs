import { test } from "node:test";
test("espera 3 s con timeout propio de 10 s", { timeout: 10_000 }, async () => {
  await new Promise((r) => setTimeout(r, 3000));
});
