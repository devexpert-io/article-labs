// Tests ocultos de la spec `partidos-abiertos`: documentación (C21). Comprueban que el README.md de la implementación
// menciona lo esencial de los partidos abiertos, sin exigir una redacción concreta.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** El README.md de la raíz de la implementación (este fichero está en test-ocultos/). */
function leerReadme(): string {
  return readFileSync(new URL("../README.md", import.meta.url), "utf8");
}

test("C21 · el README documenta los endpoints de los partidos (/api/partidos, unirse y salir) y PATCH /api/socios/:id", () => {
  const readme = leerReadme();
  assert.match(readme, /\/api\/partidos\b/, "falta la ruta /api/partidos");
  assert.match(readme, /\bunirse\b/, "falta unirse");
  assert.match(readme, /\bsalir\b/, "falta salir");
  assert.match(readme, /PATCH[^\n]*\/api\/socios|\/api\/socios[^\n]*PATCH/, "falta PATCH /api/socios/:id");
});

const ERRORES_NUEVOS = [
  "PARTIDO_NO_ENCONTRADO", "PARTIDO_COMPLETO", "PARTIDO_CANCELADO", "YA_APUNTADO", "NO_APUNTADO",
  "NIVEL_SIN_DEFINIR", "NIVEL_FUERA_DE_RANGO", "ORGANIZADOR_NO_PUEDE_SALIR", "DEMASIADO_TARDE", "ES_UN_PARTIDO",
];

test("C21 · el README documenta los errores nuevos de los partidos", () => {
  const readme = leerReadme();
  const faltan = ERRORES_NUEVOS.filter((codigo) => !new RegExp(`\\b${codigo}\\b`).test(readme));
  assert.deepEqual(faltan, [], `faltan los errores ${faltan.join(", ")}`);
});

test("C21 · el README explica el nivel de los socios, de 1 a 7", () => {
  const readme = leerReadme();
  assert.match(readme, /\bnivel/i, "falta el nivel de los socios");
  assert.match(readme, /\b1(?:[.,]0)?\b[^0-9\n]{1,25}\b7\b/, "falta el rango de niveles, de 1 a 7");
});

test("C21 · el README explica cómo se reparte el importe: cada jugador, la cuarta parte", () => {
  const readme = leerReadme();
  assert.match(
    readme,
    /importePorJugador|cuarta parte|un cuarto|partes iguales|entre\s+(los\s+)?(4|cuatro)\b|\/\s*4\b|25\s*%/i,
    "falta cómo se reparte el importe entre los jugadores",
  );
});

test("C21 · el README explica la cancelación automática, a 6 horas del partido", () => {
  const readme = leerReadme();
  assert.match(readme, /\b(6|seis)\s*(h\b|horas)/i, "falta la cancelación automática a 6 horas");
});
