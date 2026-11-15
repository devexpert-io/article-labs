// Tests ocultos de la spec `torneos`: documentación (C25). Comprueban que el README.md de la implementación menciona lo
// esencial de los torneos, sin exigir una redacción concreta. Quién hace qué no se comprueba: el README de la base ya habla
// de gestores y socios, y no hay una palabra que lo distinga.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** El README.md de la raíz de la implementación (este fichero está en test-ocultos/). */
function leerReadme(): string {
  return readFileSync(new URL("../README.md", import.meta.url), "utf8");
}

test("C25 · el README documenta los endpoints de los torneos: /api/torneos, inscripciones, bajas, cerrar, resultados y cancelar", () => {
  const readme = leerReadme();
  assert.match(readme, /\/api\/torneos\b/, "falta la ruta /api/torneos");
  for (const tramo of ["inscripciones", "baja", "cerrar", "resultado"]) {
    assert.match(readme, new RegExp(`/${tramo}\\b`), `falta la ruta …/${tramo}`);
  }
  // La base ya documenta POST /api/reservas/:id/cancelar.
  const cancelar = /\/api\/torneos\/\S*\/cancelar\b/.test(readme) || (readme.match(/\/cancelar\b/g) ?? []).length >= 2;
  assert.ok(cancelar, "falta la ruta para cancelar un torneo");
});

test("C25 · el README documenta los estados del torneo: inscripcion, en_juego, terminado y cancelado", () => {
  const readme = leerReadme();
  for (const estado of ["inscripcion", "en_juego", "terminado", "cancelado"]) {
    assert.match(readme, new RegExp(`\\b${estado}\\b`), `falta el estado ${estado}`);
  }
});

test("C25 · el README explica el plazo de inscripción: hasta 48 horas antes de la primera franja", () => {
  assert.match(leerReadme(), /\b48\s*(h\b|horas)/i, "falta el plazo de 48 horas");
});

test("C25 · el README explica cómo se forman el cuadro y el calendario, con sus descansos", () => {
  const readme = leerReadme();
  assert.match(readme, /\bcuadro\b/i, "falta el cuadro");
  assert.match(readme, /\bcalendario\b/i, "falta el calendario");
  assert.match(readme, /\bdescansos?\b/i, "faltan los descansos");
});

test("C25 · el README documenta los errores nuevos", () => {
  const readme = leerReadme();
  const nuevos = [
    "SIN_PERMISO", "TORNEO_NO_ENCONTRADO", "FRANJAS_OCUPADAS", "YA_INSCRITO", "TORNEO_COMPLETO", "INSCRIPCION_CERRADA",
    "INSCRIPCION_NO_ENCONTRADA", "YA_DE_BAJA", "TORNEO_NO_EN_INSCRIPCION", "PAREJAS_INSUFICIENTES", "FRANJAS_INSUFICIENTES",
    "TORNEO_NO_EN_JUEGO", "PARTIDO_NO_LISTO", "PARTIDO_NO_EMPEZADO", "PARTIDO_NO_ENCONTRADO", "RESULTADO_CERRADO",
    "TORNEO_TERMINADO", "YA_CANCELADO",
  ];
  const faltan = nuevos.filter((codigo) => !new RegExp(`\\b${codigo}\\b`).test(readme));
  assert.deepEqual(faltan, [], `el README no menciona: ${faltan.join(", ")}`);
});
