// Tests ocultos de la spec `reservas-fijas`: documentación (C13). Comprueban que el README.md de la implementación
// menciona lo esencial de las series, sin exigir una redacción concreta.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** El README.md de la raíz de la implementación (este fichero está en test-ocultos/). */
function leerReadme(): string {
  return readFileSync(new URL("../README.md", import.meta.url), "utf8");
}

test("C13 · el README documenta los endpoints de las series (/api/series) y los errores nuevos SERIE_VACIA y SERIE_NO_ENCONTRADA", () => {
  const readme = leerReadme();
  assert.match(readme, /\/api\/series\b/, "falta la ruta /api/series");
  assert.match(readme, /\bSERIE_VACIA\b/, "falta el error SERIE_VACIA");
  assert.match(readme, /\bSERIE_NO_ENCONTRADA\b/, "falta el error SERIE_NO_ENCONTRADA");
});

test("C13 · el README explica el descuento: un 10 % desde 8 semanas", () => {
  const readme = leerReadme();
  assert.match(readme, /\b10\s*(%|por\s*ciento)/i, "falta el descuento del 10 %");
  assert.match(readme, /\b(8|ocho|octava)\b/i, "falta desde cuántas semanas hay descuento (8)");
});
