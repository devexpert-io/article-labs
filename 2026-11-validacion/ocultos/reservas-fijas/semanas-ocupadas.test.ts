// Tests ocultos de la spec `reservas-fijas`: semanas ocupadas (C4) y comprobaciones de toda la serie (C5).
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en test-ocultos/
// dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test. Cada prueba arranca su propia API.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

// ---- Ayudas comunes: son las mismas en todos los ficheros, porque el corrector solo copia ayuda.ts y los *.test.ts ----

const GESTOR = "socio-040";
/** Lunes 4 de enero de 2027 a las 10:00: nadie tiene reservas futuras y las franjas de las pistas operativas están libres. */
const ENERO = "2027-01-04T10:00";

const abiertas = new Set<Api>();
after(() => abiertas.forEach((api) => api.cerrar()));

/**
 * Cada prueba arranca su propia API, así que no depende del orden ni de lo que cambien las demás. Por defecto, con el reloj
 * del club en ENERO y en UTC, para que la zona horaria del sistema no influya (el cambio de hora se prueba aparte, en C3).
 */
function prueba(nombre: string, cuerpo: (api: Api) => Promise<void>, entorno: Record<string, string> = {}) {
  test(nombre, { timeout: 30_000 }, async () => {
    const api = await arrancarApi({ AHORA: ENERO, TZ: "UTC", ...entorno });
    abiertas.add(api);
    try {
      await cuerpo(api);
    } finally {
      api.cerrar();
      abiertas.delete(api);
    }
  });
}

function esError(r: Respuesta, http: number, codigo: string, contexto = "") {
  assert.equal(r.status, http, `${contexto} esperaba ${http} ${codigo} y llegó ${r.status}: ${r.texto}`);
  assert.equal(r.cuerpo?.error?.codigo, codigo, `${contexto} ${r.texto}`);
}

async function reloj(api: Api, ahora: string) {
  const r = await api.pedir("POST", "/_reloj", { cuerpo: { ahora } });
  assert.equal(r.status, 200, `mover el reloj a ${ahora}: ${r.texto}`);
}

/** Socios de la semilla con rol socio y la cuota al día (en 2027 ninguno tiene reservas futuras). */
async function sociosAlDia(api: Api, cuantos: number): Promise<string[]> {
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  const ids: string[] = estado.socios.filter((s: any) => s.rol === "socio" && s.cuotaActiva === true).map((s: any) => s.id);
  assert.ok(ids.length >= cuantos, `hacen falta ${cuantos} socios con la cuota al día y hay ${ids.length}`);
  return ids.slice(0, cuantos);
}

/** Un socio de la semilla sin la cuota al día. */
async function socioSinCuota(api: Api): Promise<string> {
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  const moroso = estado.socios.find((s: any) => s.rol === "socio" && s.cuotaActiva === false);
  assert.ok(moroso, "la semilla tiene socios sin la cuota al día");
  return moroso.id;
}

/** Pide crear una serie como `socio`: el gestor si no se dice y, con null, sin cabecera X-Socio. */
function pedirSerie(api: Api, cuerpo: Record<string, unknown>, socio: string | null = GESTOR) {
  return api.pedir("POST", "/api/series", { cuerpo, socio: socio ?? undefined });
}

/** Crea una serie como el gestor y devuelve la serie de la respuesta (el 201 y la forma exacta de la respuesta se prueban en C8). */
async function crearSerie(api: Api, cuerpo: Record<string, unknown>): Promise<any> {
  const r = await pedirSerie(api, cuerpo);
  assert.ok(r.status >= 200 && r.status < 300, `crear la serie ${JSON.stringify(cuerpo)}: ${r.status} ${r.texto}`);
  const serie = r.cuerpo?.serie ?? r.cuerpo;
  assert.ok(serie?.id !== undefined && serie?.id !== null && serie?.id !== "", `la serie creada no trae id: ${r.texto}`);
  return serie;
}

function rutaSerie(serie: { id: unknown }): string {
  return `/api/series/${encodeURIComponent(String(serie.id))}`;
}

/** Cancela una serie como el gestor. */
function cancelarSerie(api: Api, serie: { id: unknown }, cuerpo: Record<string, unknown> = {}) {
  return api.pedir("POST", `${rutaSerie(serie)}/cancelar`, { cuerpo, socio: GESTOR });
}

/** Una reserva normal, para preparar (que reservar funciona igual que antes se prueba en C12). */
async function reservar(api: Api, socioId: string, pistaId: string, inicio: string): Promise<any> {
  const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio } });
  assert.ok(r.status >= 200 && r.status < 300 && r.cuerpo?.reserva, `reservar ${pistaId} ${inicio} para ${socioId}: ${r.status} ${r.texto}`);
  return r.cuerpo.reserva;
}

async function reserva(api: Api, id: string): Promise<any> {
  const r = await api.pedir("GET", `/api/reservas/${encodeURIComponent(id)}`);
  assert.equal(r.status, 200, `GET /api/reservas/${id}: ${r.texto}`);
  return r.cuerpo.reserva;
}

/** Las reservas de un socio desde el 1 de enero de 2027, por orden de inicio. */
async function reservasDe(api: Api, socioId: string): Promise<any[]> {
  const r = await api.pedir("GET", `/api/reservas?socio=${socioId}&desde=2027-01-01&limite=100`);
  assert.equal(r.status, 200, `GET /api/reservas del socio ${socioId}: ${r.texto}`);
  return [...r.cuerpo.reservas].sort((a: any, b: any) => a.inicio.localeCompare(b.inicio));
}

/** Cuántas reservas hay en el club, para comprobar que no se ha creado ninguna. */
async function totalReservas(api: Api): Promise<number> {
  const r = await api.pedir("GET", "/api/reservas?limite=1");
  assert.equal(r.status, 200, r.texto);
  return r.cuerpo.total;
}

/** Los ids de una lista de la respuesta, que puede traer ids o reservas completas (la spec no lo fija en canceladas y pendientes). */
function ids(lista: unknown, contexto = ""): string[] {
  assert.ok(Array.isArray(lista), `${contexto} esperaba una lista y llegó ${JSON.stringify(lista)}`);
  return lista.map((x: any) => (x !== null && typeof x === "object" ? x.id : x));
}

/** Las semanas saltadas de una serie como [inicio, codigo], por orden de inicio (la spec no fija el orden ni prohíbe campos extra). */
function saltadas(serie: any): [string, string][] {
  assert.ok(Array.isArray(serie?.saltadas), `la serie no trae la lista saltadas: ${JSON.stringify(serie)}`);
  return serie.saltadas.map((s: any) => [s.inicio, s.codigo] as [string, string]).sort((a: [string, string], b: [string, string]) => a[0].localeCompare(b[0]));
}

/** Sin penalización vale tanto sin el campo como con 0. */
function sinPenalizacion(r: any) {
  assert.equal(r.penalizacion ?? 0, 0, `no debía tener penalización: ${JSON.stringify(r)}`);
}

// ---- Tests ----

prueba("C4 · una semana con la franja ya reservada se salta y queda en saltadas con su inicio y FRANJA_NO_DISPONIBLE; las demás se reservan", async (api) => {
  const [socio, otro] = await sociosAlDia(api, 2);
  const ocupada = await reservar(api, otro, "pista-2", "2027-01-14T18:00");
  const serie = await crearSerie(api, { socioId: socio, pistaId: "pista-2", inicio: "2027-01-07T18:00", semanas: 3 });
  assert.deepEqual(saltadas(serie), [["2027-01-14T18:00", "FRANJA_NO_DISPONIBLE"]]);
  assert.deepEqual((await reservasDe(api, socio)).map((r) => [r.pistaId, r.inicio, r.estado]), [
    ["pista-2", "2027-01-07T18:00", "confirmada"],
    ["pista-2", "2027-01-21T18:00", "confirmada"],
  ]);
  const despues = await reserva(api, ocupada.id);
  assert.deepEqual([despues.socioId, despues.inicio, despues.estado], [otro, "2027-01-14T18:00", "confirmada"], "la reserva que ocupaba la franja sigue igual");
});

prueba("C4 · también se salta la primera semana si su franja ya está reservada, y varias semanas si lo están", async (api) => {
  const [socio, otro, tercero] = await sociosAlDia(api, 3);
  await reservar(api, otro, "pista-1", "2027-01-05T10:30");
  await reservar(api, otro, "pista-1", "2027-01-19T10:30");
  const serie = await crearSerie(api, { socioId: socio, pistaId: "pista-1", inicio: "2027-01-05T10:30", semanas: 4 });
  assert.deepEqual(saltadas(serie), [["2027-01-05T10:30", "FRANJA_NO_DISPONIBLE"], ["2027-01-19T10:30", "FRANJA_NO_DISPONIBLE"]]);
  assert.deepEqual((await reservasDe(api, socio)).map((r) => [r.pistaId, r.inicio, r.estado]), [
    ["pista-1", "2027-01-12T10:30", "confirmada"],
    ["pista-1", "2027-01-26T10:30", "confirmada"],
  ]);
  // Solo cuenta la misma pista: una reserva en otra pista a la misma hora no hace saltar ninguna semana.
  await reservar(api, otro, "pista-1", "2027-01-13T12:00");
  const otraPista = await crearSerie(api, { socioId: tercero, pistaId: "pista-2", inicio: "2027-01-06T12:00", semanas: 2 });
  assert.deepEqual(saltadas(otraPista), []);
});

prueba("C4 · una franja con una reserva cancelada está libre: esa semana se reserva", async (api) => {
  const [socio, otro] = await sociosAlDia(api, 2);
  const anulada = await reservar(api, otro, "pista-3", "2027-01-13T12:00");
  const cancelada = await api.pedir("POST", `/api/reservas/${anulada.id}/cancelar`, { cuerpo: {} });
  assert.equal(cancelada.status, 200, cancelada.texto);
  const serie = await crearSerie(api, { socioId: socio, pistaId: "pista-3", inicio: "2027-01-06T12:00", semanas: 3 });
  assert.deepEqual(saltadas(serie), []);
  assert.deepEqual((await reservasDe(api, socio)).map((r) => [r.inicio, r.estado]), [
    ["2027-01-06T12:00", "confirmada"],
    ["2027-01-13T12:00", "confirmada"],
    ["2027-01-20T12:00", "confirmada"],
  ]);
});

prueba("C4 · si la franja está reservada todas las semanas, 409 SERIE_VACIA y no se crea nada", async (api) => {
  const [socio, otro] = await sociosAlDia(api, 2);
  const ocupadas = [];
  for (const inicio of ["2027-01-08T19:30", "2027-01-15T19:30", "2027-01-22T19:30"]) ocupadas.push(await reservar(api, otro, "pista-3", inicio));
  const antes = await totalReservas(api);
  esError(await pedirSerie(api, { socioId: socio, pistaId: "pista-3", inicio: "2027-01-08T19:30", semanas: 3 }), 409, "SERIE_VACIA");
  assert.equal(await totalReservas(api), antes, "no se crea ninguna reserva");
  assert.deepEqual(await reservasDe(api, socio), []);
  for (const r of ocupadas) {
    const despues = await reserva(api, r.id);
    assert.deepEqual([despues.socioId, despues.estado], [otro, "confirmada"], "las reservas que ocupaban las franjas siguen igual");
  }
});

prueba("C5 · si el socio no tiene la cuota al día, 409 CUOTA_INACTIVA y no se crea nada", async (api) => {
  const moroso = await socioSinCuota(api);
  const antes = await totalReservas(api);
  esError(await pedirSerie(api, { socioId: moroso, pistaId: "pista-1", inicio: "2027-01-05T10:30", semanas: 3 }), 409, "CUOTA_INACTIVA");
  assert.equal(await totalReservas(api), antes, "no se crea ninguna reserva");
  assert.deepEqual(await reservasDe(api, moroso), []);
});

prueba("C5 · si la pista está cerrada, 409 PISTA_CERRADA y no se crea nada", async (api) => {
  const [socio] = await sociosAlDia(api, 1);
  const antes = await totalReservas(api);
  esError(await pedirSerie(api, { socioId: socio, pistaId: "pista-4", inicio: "2027-01-05T10:30", semanas: 3 }), 409, "PISTA_CERRADA", "pista-4, cerrada en la semilla:");
  const cierre = await api.pedir("PATCH", "/api/pistas/pista-2", { cuerpo: { estado: "cerrada" } });
  assert.equal(cierre.status, 200, cierre.texto);
  esError(await pedirSerie(api, { socioId: socio, pistaId: "pista-2", inicio: "2027-01-05T10:30", semanas: 3 }), 409, "PISTA_CERRADA", "pista-2, recién cerrada:");
  assert.equal(await totalReservas(api), antes, "no se crea ninguna reserva");
  assert.deepEqual(await reservasDe(api, socio), []);
});
