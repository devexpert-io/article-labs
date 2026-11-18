// Tests ocultos de la spec codigos-descuento: la documentación del README (C11).
// Solo comprueban que el README.md de la implementación menciona lo esencial, sin exigir una redacción concreta.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Este fichero se copia a test-ocultos/, dentro de la implementación: el README está en la carpeta de arriba.
const leerReadme = () => readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("C11 · el README explica el campo codigo", () => {
  // La base ya escribe "codigo" en el formato de los errores ({"error": {"codigo": …}}): esa mención no cuenta.
  const sinFormatoDeErrores = leerReadme().replace(/"?error"?\s*:\s*\{\s*"?codigo"?/g, "");
  assert.match(sinFormatoDeErrores, /\bcodigo\b/, "el README no menciona el campo codigo");
});

test("C11 · el README documenta el catálogo: BIENVENIDA, MANANAS y CLUB10", () => {
  const readme = leerReadme();
  for (const codigo of ["BIENVENIDA", "MANANAS", "CLUB10"]) assert.ok(readme.includes(codigo), `el README no menciona ${codigo}`);
});

test("C11 · el README documenta los campos nuevos de la reserva: importeBase y descuento", () => {
  const readme = leerReadme();
  for (const campo of ["importeBase", "descuento"]) assert.ok(readme.includes(campo), `el README no menciona ${campo}`);
});

test("C11 · el README documenta los errores nuevos: CODIGO_INVALIDO y CODIGO_NO_APLICABLE", () => {
  const readme = leerReadme();
  for (const error of ["CODIGO_INVALIDO", "CODIGO_NO_APLICABLE"]) assert.ok(readme.includes(error), `el README no menciona ${error}`);
});
