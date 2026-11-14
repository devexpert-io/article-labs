// Tests ocultos de la spec `facturas`: documentación (C10). Comprueban que el README.md de la implementación menciona
// lo esencial, sin exigir una redacción concreta.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** El README.md de la raíz de la implementación (este fichero está en test-ocultos/). */
function leerReadme(): string {
  return readFileSync(new URL("../README.md", import.meta.url), "utf8");
}

test("C10 · el README documenta los endpoints de facturas (/api/facturas)", () => {
  assert.ok(/\/api\/facturas\b/.test(leerReadme()), "falta la ruta /api/facturas");
});

test("C10 · el README documenta los errores nuevos: MES_ABIERTO y FACTURA_NO_ENCONTRADA", () => {
  const readme = leerReadme();
  assert.ok(/\bMES_ABIERTO\b/.test(readme), "falta MES_ABIERTO");
  assert.ok(/\bFACTURA_NO_ENCONTRADA\b/.test(readme), "falta FACTURA_NO_ENCONTRADA");
});

test("C10 · el README explica el IVA del 21 % que llevan los importes", () => {
  const readme = leerReadme();
  assert.ok(/\bIVA\b/i.test(readme), "falta el IVA");
  assert.ok(/\b21\s*(%|por\s*ciento)|\b1[,.]21\b/i.test(readme), "falta el 21 % (o el 1,21 con el que se calcula la base)");
});
