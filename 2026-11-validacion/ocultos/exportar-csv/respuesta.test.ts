// Tests ocultos de exportar-csv, criterios 2 (respuesta) y 3 (cabecera del CSV). Caja negra: solo la API HTTP.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

const GESTOR = "socio-040";
const CABECERA = "id,fecha,hora,pista,socio,email,estado,importe,penalizacion,notas";
/** Si la API se cuelga, el test falla a los 30 segundos y la API se cierra. */
const OPCIONES = { timeout: 30_000 };

/** Arranca una API solo para este test, con la hora de Madrid (la del club), y la cierra al terminar. */
async function conApi(t: TestContext, prueba: (api: Api) => Promise<void>): Promise<void> {
  const api = await arrancarApi({ TZ: "Europe/Madrid" });
  t.signal.addEventListener("abort", () => api.cerrar(), { once: true });
  try {
    await prueba(api);
  } finally {
    api.cerrar();
  }
}

/** Pide la exportación como el gestor, como otro socio o, con null, sin cabecera X-Socio. */
function exportar(api: Api, consulta: string, socio: string | null = GESTOR) {
  return api.pedir("GET", `/api/reservas/exportar?${consulta}`, socio === null ? {} : { socio });
}

/** El content-type sin espacios y en minúsculas: "text/csv; charset=UTF-8" y "text/csv;charset=utf-8" son lo mismo en HTTP. */
function tipoDeContenido(r: Respuesta): string {
  return (r.cabeceras.get("content-type") ?? "").toLowerCase().replace(/\s+/g, "");
}

/** El tipo de content-disposition y su filename (entre comillas o sin ellas, que en HTTP es lo mismo). */
function disposicion(r: Respuesta): { tipo: string; fichero: string | undefined } {
  const [tipo = "", ...parametros] = (r.cabeceras.get("content-disposition") ?? "").split(";").map((p) => p.trim());
  let fichero: string | undefined;
  for (const parametro of parametros) {
    const encontrado = /^filename\s*=\s*(?:"([^"]*)"|([^\s"]+))$/i.exec(parametro);
    if (encontrado) fichero = encontrado[1] ?? encontrado[2];
  }
  return { tipo: tipo.toLowerCase(), fichero };
}

/** La primera línea del cuerpo, termine en CRLF o en LF (el fin de línea es cosa del criterio 7). */
function primeraLinea(texto: string): string {
  return texto.split("\n")[0]!.replace(/\r$/, "");
}

test("C2 · responde 200 con content-type text/csv; charset=utf-8", OPCIONES, (t) => conApi(t, async (api) => {
  const r = await exportar(api, "desde=2026-11-01&hasta=2026-11-30");
  assert.equal(r.status, 200, r.texto.slice(0, 300));
  assert.equal(tipoDeContenido(r), "text/csv;charset=utf-8", `content-type: ${r.cabeceras.get("content-type")}`);
}));

test("C2 · content-disposition es attachment con filename reservas-<desde>-<hasta>.csv", OPCIONES, (t) => conApi(t, async (api) => {
  for (const [desde, hasta] of [["2026-11-01", "2026-11-30"], ["2026-10-15", "2026-10-15"], ["2026-12-20", "2027-01-10"]]) {
    const r = await exportar(api, `desde=${desde}&hasta=${hasta}`);
    assert.equal(r.status, 200, r.texto.slice(0, 300));
    const cabecera = r.cabeceras.get("content-disposition");
    assert.deepEqual(disposicion(r), { tipo: "attachment", fichero: `reservas-${desde}-${hasta}.csv` }, `content-disposition: ${cabecera}`);
  }
}));

test("C2 · al filtrar por estado, el fichero se sigue llamando reservas-<desde>-<hasta>.csv", OPCIONES, (t) => conApi(t, async (api) => {
  const r = await exportar(api, "desde=2026-10-01&hasta=2026-10-31&estado=cancelada");
  assert.equal(r.status, 200, r.texto.slice(0, 300));
  assert.equal(tipoDeContenido(r), "text/csv;charset=utf-8", `content-type: ${r.cabeceras.get("content-type")}`);
  const cabecera = r.cabeceras.get("content-disposition");
  assert.deepEqual(disposicion(r), { tipo: "attachment", fichero: "reservas-2026-10-01-2026-10-31.csv" }, `content-disposition: ${cabecera}`);
}));

test("C2 · un periodo sin reservas también responde 200 con esas cabeceras", OPCIONES, (t) => conApi(t, async (api) => {
  const r = await exportar(api, "desde=2030-01-01&hasta=2030-01-31");
  assert.equal(r.status, 200, r.texto.slice(0, 300));
  assert.equal(tipoDeContenido(r), "text/csv;charset=utf-8", `content-type: ${r.cabeceras.get("content-type")}`);
  const cabecera = r.cabeceras.get("content-disposition");
  assert.deepEqual(disposicion(r), { tipo: "attachment", fichero: "reservas-2030-01-01-2030-01-31.csv" }, `content-disposition: ${cabecera}`);
}));

test("C3 · la primera línea es la cabecera exacta, con las columnas en su orden", OPCIONES, (t) => conApi(t, async (api) => {
  const r = await exportar(api, "desde=2026-10-01&hasta=2026-11-30");
  assert.ok(r.status >= 200 && r.status < 300, `${r.status} ${r.texto.slice(0, 300)}`);
  assert.equal(primeraLinea(r.texto), CABECERA);
}));

test("C3 · la cabecera sale también cuando no hay filas y al filtrar por estado", OPCIONES, (t) => conApi(t, async (api) => {
  for (const consulta of ["desde=2030-01-01&hasta=2030-01-31", "desde=2026-10-01&hasta=2026-11-30&estado=no_presentada"]) {
    const r = await exportar(api, consulta);
    assert.ok(r.status >= 200 && r.status < 300, `${consulta}: ${r.status} ${r.texto.slice(0, 300)}`);
    assert.equal(primeraLinea(r.texto), CABECERA, consulta);
  }
}));
