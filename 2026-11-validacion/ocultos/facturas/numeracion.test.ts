// Tests ocultos de la spec `facturas`: numeración (C6). Caja negra: solo la API HTTP, con /_reloj para preparar
// diciembre de 2026 y enero de 2027 y cerrarlos. Cada escenario se prueba con la API en Europe/Madrid y en UTC.
// Los números esperados salen de las facturas que devuelve la API (cuántas y de qué socios es cosa de C3): aquí solo
// se mira que se numeren F<año>-<4 cifras>, por orden de socio, sin huecos ni repetidos y siguiendo la serie del año.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

const GESTOR = "socio-040";
const OPCIONES = { timeout: 60_000 };
const ZONAS = ["Europe/Madrid", "UTC"] as const;

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const abiertas = new Set<Api>();
after(() => abiertas.forEach((api) => api.cerrar()));

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

async function reservar(api: Api, socioId: string, pistaId: string, inicio: string): Promise<{ id: string }> {
  const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio } });
  assert.equal(r.status, 201, `reservar ${pistaId} el ${inicio} para ${socioId}: ${r.texto}`);
  return r.cuerpo.reserva;
}

async function cancelar(api: Api, reserva: { id: string }) {
  const r = await api.pedir("POST", `/api/reservas/${reserva.id}/cancelar`, { cuerpo: {} });
  assert.equal(r.status, 200, `cancelar ${reserva.id}: ${r.texto}`);
}

/**
 * Reservas en diciembre de 2026 y en enero de 2027, cada una con el reloj en el mes anterior, y el reloj al final en
 * febrero de 2027, con los dos meses cerrados. Los socios no reservan en el orden de su id.
 */
async function prepararDiciembreYEnero(api: Api) {
  await reloj(api, "2026-11-30T10:00");
  await reservar(api, "socio-037", "pista-1", "2026-12-02T18:00");
  await reservar(api, "socio-002", "pista-2", "2026-12-03T10:30");
  await reservar(api, "socio-041", "pista-3", "2026-12-05T09:00");
  // Cancelada a tiempo: socio-012 no tiene nada que facturar en diciembre.
  await cancelar(api, await reservar(api, "socio-012", "pista-1", "2026-12-14T19:30"));
  await reservar(api, "socio-020", "pista-2", "2026-12-31T21:00");
  await reservar(api, "socio-005", "pista-1", "2026-12-01T09:00");
  await reloj(api, "2026-12-28T10:00");
  await reservar(api, "socio-039", "pista-1", "2027-01-01T09:00");
  await reservar(api, "socio-008", "pista-2", "2027-01-04T18:00");
  await reservar(api, "socio-003", "pista-3", "2027-01-31T21:00");
  await reservar(api, "socio-020", "pista-1", "2027-01-15T12:00");
  await reloj(api, "2027-02-01T10:00");
}

/** Genera un mes como gestor. Aquí da igual si responde 201 o 200: eso es de C7. */
async function generar(api: Api, mes: string): Promise<any[]> {
  const r = await api.pedir("POST", "/api/facturas", { cuerpo: { mes }, socio: GESTOR });
  assert.ok(r.status === 201 || r.status === 200, `generar ${mes}: esperaba 201 o 200 y llegó ${r.status}: ${r.texto.slice(0, 300)}`);
  assert.ok(Array.isArray(r.cuerpo?.facturas), `generar ${mes} debe responder { facturas }: ${r.texto.slice(0, 300)}`);
  return r.cuerpo.facturas;
}

/**
 * Genera los meses en el orden dado y comprueba que cada uno sigue la serie de su año donde la dejó el último generado
 * de ese año (o empieza en 0001), con los números asignados por orden de id de socio.
 */
async function comprobarSerie(api: Api, meses: string[]) {
  const ultimo = new Map<string, number>();
  for (const mes of meses) {
    const año = mes.slice(0, 4);
    const facturas = await generar(api, mes);
    const porSocio = [...facturas].sort((a, b) => comparar(String(a?.socioId), String(b?.socioId)));
    const anterior = ultimo.get(año) ?? 0;
    const esperados = porSocio.map((_, i) => `F${año}-${String(anterior + i + 1).padStart(4, "0")}`);
    assert.deepEqual(
      porSocio.map((f) => f?.numero),
      esperados,
      `${mes}: por orden de socio, los números deben seguir a F${año}-${String(anterior).padStart(4, "0")} (orden de generación: ${meses.join(", ")})`,
    );
    ultimo.set(año, anterior + facturas.length);
  }
  // Para que la serie de cada año no se compruebe en vacío. Qué meses tienen facturas es de C3.
  for (const [año, n] of ultimo) assert.ok(n > 0, `${año}: hay reservas que facturar y no ha salido ninguna factura`);
}

for (const TZ of ZONAS) {
  test(`C6 · (TZ=${TZ}) octubre, noviembre y diciembre de 2026 siguen una sola serie desde F2026-0001, también diciembre generado ya en 2027, y enero de 2027 empieza en F2027-0001`, OPCIONES, async () => {
    await conApi(TZ, async (api) => {
      await prepararDiciembreYEnero(api);
      await comprobarSerie(api, ["2026-10", "2026-11", "2026-12", "2027-01"]);
    });
  });

  test(`C6 · (TZ=${TZ}) un mes sigue la numeración donde la dejó el último generado de su año aunque se generen fuera de orden, y un mes sin facturas no gasta números`, OPCIONES, async () => {
    await conApi(TZ, async (api) => {
      await prepararDiciembreYEnero(api);
      await comprobarSerie(api, ["2027-01", "2026-12", "2026-09", "2026-11", "2026-10"]);
    });
  });
}
