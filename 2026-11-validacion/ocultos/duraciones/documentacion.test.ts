// Tests ocultos de la spec `duraciones`: documentación (C12). Comprueban que el README.md de la implementación menciona lo
// esencial (el campo duracion, el campo huecos y el error DURACION_INVALIDA), sin exigir una redacción concreta.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** El README.md de la raíz de la implementación (este fichero está en test-ocultos/). */
function leerReadme(): string {
  return readFileSync(new URL("../README.md", import.meta.url), "utf8");
}

test("C12 · el README documenta el campo duracion y el error nuevo, DURACION_INVALIDA", () => {
  const readme = leerReadme();
  assert.match(readme, /\bduracion\b/, "falta el campo duracion");
  assert.match(readme, /\bDURACION_INVALIDA\b/, "falta el error DURACION_INVALIDA");
});

test("C12 · el README documenta el campo huecos de la disponibilidad", () => {
  assert.match(leerReadme(), /\bhuecos\b/, "falta el campo huecos");
});
