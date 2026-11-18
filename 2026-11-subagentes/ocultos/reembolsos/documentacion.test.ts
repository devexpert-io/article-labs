// Tests ocultos de la spec `reembolsos`: documentación (C9). Comprueban que el README.md de la implementación
// menciona lo esencial, sin exigir una redacción concreta.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** El README.md de la raíz de la implementación (este fichero está en test-ocultos/). */
function leerReadme(): string {
  return readFileSync(new URL("../README.md", import.meta.url), "utf8");
}

test("C9 · el README explica los tramos nuevos de cancelación: 48 horas, 25 % y 50 %", () => {
  const readme = leerReadme();
  assert.match(readme, /\b48\b/, "falta el tramo de 48 horas");
  assert.match(readme, /\b25\s*(%|por\s*ciento)/i, "falta la penalización del 25 %");
  assert.match(readme, /\b50\s*(%|por\s*ciento)/i, "falta la penalización del 50 %");
});

test("C9 · el README documenta exento, reembolso y el informe de caja (GET /api/informes/caja)", () => {
  const readme = leerReadme();
  assert.match(readme, /\bexento\b/, "falta exento");
  assert.match(readme, /\breembolso\b/, "falta reembolso");
  assert.match(readme, /\/api\/informes\/caja\b/, "falta la ruta del informe de caja");
});
