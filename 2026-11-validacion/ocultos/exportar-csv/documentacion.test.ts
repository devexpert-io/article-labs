// Tests ocultos de exportar-csv, criterio 11 (documentación). Miran el README.md de la implementación, sin exigir
// una redacción concreta: solo que mencione la ruta del endpoint y los códigos de error que trae la feature.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** El README.md de la raíz de la implementación (los tests se copian a test-ocultos/, una carpeta por debajo). */
function readme(): string {
  return readFileSync(new URL("../README.md", import.meta.url), "utf8");
}

test("C11 · el README documenta la ruta GET /api/reservas/exportar", () => {
  assert.match(readme(), /\/api\/reservas\/exportar\b/);
});

test("C11 · el README documenta los códigos de error nuevos, SIN_PERMISO y RANGO_DEMASIADO_GRANDE", () => {
  const texto = readme();
  for (const codigo of ["SIN_PERMISO", "RANGO_DEMASIADO_GRANDE"]) assert.ok(texto.includes(codigo), `el README no menciona ${codigo}`);
});
