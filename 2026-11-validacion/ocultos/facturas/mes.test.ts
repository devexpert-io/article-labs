// Tests ocultos de la spec `facturas`: mes cerrado (C2). `mes` es AAAA-MM y solo se factura un mes que ya ha terminado
// según la hora del club. Caja negra: solo la API HTTP, con /_reloj para mover la hora del club. Lo que depende de la
// fecha se prueba con la API en Europe/Madrid y en UTC: la hora del club es la misma con las dos.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

const GESTOR = "socio-040";
const OPCIONES = { timeout: 30_000 };
const ZONAS = ["Europe/Madrid", "UTC"] as const;

const abiertas = new Set<Api>();
after(() => abiertas.forEach((api) => api.cerrar()));

/** Una API solo para esta prueba, con la hora de la semilla (miércoles 18 de noviembre de 2026 a las 10:00). */
async function conApi(TZ: string, prueba: (api: Api) => Promise<void>) {
  const api = await arrancarApi({ TZ });
  abiertas.add(api);
  try {
    await prueba(api);
  } finally {
    api.cerrar();
    abiertas.delete(api);
  }
}

async function reloj(api: Api, ahora: string) {
  const r = await api.pedir("POST", "/_reloj", { cuerpo: { ahora } });
  assert.equal(r.status, 200, `mover el reloj a ${ahora}: ${r.texto}`);
}

function generar(api: Api, cuerpo: unknown) {
  return api.pedir("POST", "/api/facturas", { cuerpo, socio: GESTOR });
}

function esError(r: Respuesta, http: number, codigo: string, contexto = "") {
  assert.equal(r.status, http, `${contexto} esperaba ${http} ${codigo} y llegó ${r.status}: ${r.texto.slice(0, 300)}`);
  assert.equal(r.cuerpo?.error?.codigo, codigo, `${contexto} ${r.texto.slice(0, 300)}`);
}

/** Un mes cerrado se genera: 201 la primera vez o 200 si ya estaba (eso es de C7), con { facturas }. */
function seGenera(r: Respuesta, contexto: string) {
  assert.ok(r.status === 201 || r.status === 200, `${contexto} esperaba 201 o 200 y llegó ${r.status}: ${r.texto.slice(0, 300)}`);
  assert.ok(Array.isArray(r.cuerpo?.facturas), `${contexto} debe responder { facturas }: ${r.texto.slice(0, 300)}`);
}

test("C2 · con un mes que no tiene el formato AAAA-MM, o sin mes, generar responde 400 DATOS_INVALIDOS", OPCIONES, async () => {
  await conApi("UTC", async (api) => {
    const malos: unknown[] = ["2026-1", "2026/10", "octubre", "2026-10-01", "10-2026", "202610", "26-10", "", 202610, null];
    for (const mes of malos) esError(await generar(api, { mes }), 400, "DATOS_INVALIDOS", `mes=${JSON.stringify(mes)}:`);
    esError(await generar(api, {}), 400, "DATOS_INVALIDOS", "sin mes:");
    esError(await api.pedir("POST", "/api/facturas", { socio: GESTOR }), 400, "DATOS_INVALIDOS", "sin cuerpo:");
  });
});

for (const TZ of ZONAS) {
  test(`C2 · (TZ=${TZ}) el mes en curso y los que todavía no han terminado responden 409 MES_ABIERTO, y los ya terminados se generan`, OPCIONES, async () => {
    await conApi(TZ, async (api) => {
      for (const mes of ["2026-11", "2026-12", "2027-01", "2030-06"]) {
        esError(await generar(api, { mes }), 409, "MES_ABIERTO", `${mes} con el club a 2026-11-18T10:00:`);
      }
      for (const mes of ["2026-10", "2025-11"]) seGenera(await generar(api, { mes }), `${mes} con el club a 2026-11-18T10:00:`);
    });
  });

  test(`C2 · (TZ=${TZ}) un mes se puede facturar a partir de las 00:00 del día 1 del mes siguiente en la hora del club, y no antes`, OPCIONES, async () => {
    await conApi(TZ, async (api) => {
      const pasos: [ahora: string, abiertos: string[], cerrados: string[]][] = [
        ["2026-11-30T23:00", ["2026-11"], []],
        ["2026-11-30T23:59", ["2026-11"], []],
        ["2026-12-01T00:00", ["2026-12"], ["2026-11"]],
        ["2026-12-31T23:59", ["2026-12"], []],
        ["2027-01-01T00:00", ["2027-01"], ["2026-12"]],
      ];
      for (const [ahora, abiertos, cerrados] of pasos) {
        await reloj(api, ahora);
        for (const mes of abiertos) esError(await generar(api, { mes }), 409, "MES_ABIERTO", `${mes} con el club a ${ahora}:`);
        for (const mes of cerrados) seGenera(await generar(api, { mes }), `${mes} con el club a ${ahora}:`);
      }
    });
  });
}
