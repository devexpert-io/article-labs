// Tests ocultos de exportar-csv, criterio 8 (periodo). Caja negra: solo la API HTTP.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

const GESTOR = "socio-040";
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

/** Pide la exportación como el gestor, con los parámetros que haya (los que valen undefined no se mandan). */
function exportar(api: Api, parametros: Record<string, string | undefined>) {
  const consulta = Object.entries(parametros)
    .filter(([, valor]) => valor !== undefined)
    .map(([nombre, valor]) => `${nombre}=${encodeURIComponent(valor!)}`)
    .join("&");
  return api.pedir("GET", `/api/reservas/exportar?${consulta}`, { socio: GESTOR });
}

async function comprobarError(api: Api, parametros: Record<string, string | undefined>, codigo: string) {
  const r = await exportar(api, parametros);
  const caso = JSON.stringify(parametros);
  assert.equal(r.status, 400, `${caso}: ${r.texto.slice(0, 300)}`);
  assert.equal(r.cuerpo?.error?.codigo, codigo, caso);
}

test("C8 · sin desde o sin hasta responde 400 DATOS_INVALIDOS", OPCIONES, (t) => conApi(t, async (api) => {
  for (const parametros of [{ hasta: "2026-11-30" }, { desde: "2026-11-01" }, {}, { estado: "confirmada" }]) {
    await comprobarError(api, parametros, "DATOS_INVALIDOS");
  }
}));

test("C8 · una fecha que no tiene el formato AAAA-MM-DD responde 400 DATOS_INVALIDOS", OPCIONES, (t) => conApi(t, async (api) => {
  const malas = ["2026-11-1", "2026-1-01", "26-11-01", "2026/11/01", "01-11-2026", "2026-11-01T10:00", "20261101", "hoy", ""];
  for (const mala of malas) {
    await comprobarError(api, { desde: mala, hasta: "2026-11-30" }, "DATOS_INVALIDOS");
    await comprobarError(api, { desde: "2026-11-01", hasta: mala }, "DATOS_INVALIDOS");
  }
}));

test("C8 · desde posterior a hasta responde 400 DATOS_INVALIDOS", OPCIONES, (t) => conApi(t, async (api) => {
  for (const [desde, hasta] of [["2026-11-30", "2026-11-01"], ["2026-11-02", "2026-11-01"], ["2027-01-01", "2026-12-31"]]) {
    await comprobarError(api, { desde, hasta }, "DATOS_INVALIDOS");
  }
}));

test("C8 · desde igual a hasta es un periodo válido, de un día", OPCIONES, (t) => conApi(t, async (api) => {
  for (const dia of ["2026-11-19", "2027-03-28"]) {
    const r = await exportar(api, { desde: dia, hasta: dia });
    assert.ok(r.status >= 200 && r.status < 300, `${dia}: ${r.status} ${r.texto.slice(0, 300)}`);
  }
}));

// Periodos de 92 días contando los dos extremos: con el cambio de hora de octubre o de marzo por medio, con cambio
// de año y con un 29 de febrero. Un día más y ya son 93.
const PERIODOS_DE_92_DIAS = [
  ["2026-09-01", "2026-12-01"],
  ["2026-11-18", "2027-02-17"],
  ["2027-01-01", "2027-04-02"],
  ["2028-01-01", "2028-04-01"],
];

test("C8 · un periodo de 92 días, contando los dos extremos, se exporta", OPCIONES, (t) => conApi(t, async (api) => {
  for (const [desde, hasta] of PERIODOS_DE_92_DIAS) {
    const r = await exportar(api, { desde, hasta });
    assert.ok(r.status >= 200 && r.status < 300, `${desde} a ${hasta} son 92 días: ${r.status} ${r.texto.slice(0, 300)}`);
  }
}));

test("C8 · un periodo de más de 92 días responde 400 RANGO_DEMASIADO_GRANDE", OPCIONES, (t) => conApi(t, async (api) => {
  const unDiaMas = (fecha: string) => new Date(Date.parse(`${fecha}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const periodos = [...PERIODOS_DE_92_DIAS.map(([desde, hasta]) => [desde!, unDiaMas(hasta!)]), ["2026-01-01", "2026-12-31"]];
  for (const [desde, hasta] of periodos) await comprobarError(api, { desde, hasta }, "RANGO_DEMASIADO_GRANDE");
  // El límite vale también al filtrar por estado.
  await comprobarError(api, { desde: "2026-09-01", hasta: "2026-12-02", estado: "cancelada" }, "RANGO_DEMASIADO_GRANDE");
}));
