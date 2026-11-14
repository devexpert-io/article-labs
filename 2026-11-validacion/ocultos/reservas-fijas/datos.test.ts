// Tests ocultos de la spec `reservas-fijas`: datos (C2).
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en test-ocultos/
// dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test. Cada prueba arranca su propia API.
// Cada caso tiene un solo dato mal y los demás bien: la spec no fija qué error gana cuando fallan varios.
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

const FRANJA = { pistaId: "pista-1", inicio: "2027-01-05T10:30" };

prueba("C2 · semanas tiene que ser un entero entre 2 y 12: si no, 400 DATOS_INVALIDOS y no se crea nada", async (api) => {
  const [socio, otro] = await sociosAlDia(api, 2);
  const antes = await totalReservas(api);
  for (const semanas of [1, 13, 0, -3, 2.5, 12.5, null]) {
    esError(await pedirSerie(api, { socioId: socio, ...FRANJA, semanas }), 400, "DATOS_INVALIDOS", `semanas = ${semanas}:`);
  }
  esError(await pedirSerie(api, { socioId: socio, ...FRANJA }), 400, "DATOS_INVALIDOS", "sin semanas:");
  assert.equal(await totalReservas(api), antes, "con semanas inválidas no se crea ninguna reserva");

  // 2 y 12 son válidos (que la respuesta sea un 201 se prueba en C8).
  const dos = await pedirSerie(api, { socioId: socio, ...FRANJA, semanas: 2 });
  assert.ok(dos.status >= 200 && dos.status < 300, `semanas = 2: ${dos.status} ${dos.texto}`);
  const doce = await pedirSerie(api, { socioId: otro, pistaId: "pista-2", inicio: FRANJA.inicio, semanas: 12 });
  assert.ok(doce.status >= 200 && doce.status < 300, `semanas = 12: ${doce.status} ${doce.texto}`);
});

prueba("C2 · el socio y la pista tienen que existir: 404 SOCIO_NO_ENCONTRADO y 404 PISTA_NO_ENCONTRADA, y no se crea nada", async (api) => {
  const [socio] = await sociosAlDia(api, 1);
  const antes = await totalReservas(api);
  esError(await pedirSerie(api, { socioId: "socio-999", ...FRANJA, semanas: 3 }), 404, "SOCIO_NO_ENCONTRADO");
  esError(await pedirSerie(api, { socioId: socio, pistaId: "pista-9", inicio: FRANJA.inicio, semanas: 3 }), 404, "PISTA_NO_ENCONTRADA");
  assert.equal(await totalReservas(api), antes, "no se crea ninguna reserva");
});

prueba("C2 · inicio tiene que ser una franja válida: 400 FRANJA_INVALIDA y no se crea nada", async (api) => {
  const [socio] = await sociosAlDia(api, 1);
  const antes = await totalReservas(api);
  // Fechas y horas bien formadas que no son el inicio de ninguna franja (empiezan a las 09:00, 10:30, ..., 21:00).
  for (const inicio of ["2027-01-05T10:00", "2027-01-05T09:15", "2027-01-05T22:30", "2027-01-05T08:00"]) {
    esError(await pedirSerie(api, { socioId: socio, pistaId: "pista-1", inicio, semanas: 3 }), 400, "FRANJA_INVALIDA", `inicio = ${inicio}:`);
  }
  assert.equal(await totalReservas(api), antes, "no se crea ninguna reserva");
});

prueba("C2 · inicio no puede haber empezado: 409 FRANJA_PASADA y no se crea nada, aunque las semanas siguientes sean futuras", async (api) => {
  const [socio] = await sociosAlDia(api, 1);
  const antes = await totalReservas(api);
  // El reloj está en el lunes 4 de enero de 2027 a las 10:00.
  for (const [inicio, semanas] of [["2027-01-04T09:00", 3], ["2026-12-28T10:30", 3], ["2026-12-21T19:30", 4]] as const) {
    esError(await pedirSerie(api, { socioId: socio, pistaId: "pista-2", inicio, semanas }), 409, "FRANJA_PASADA", `inicio = ${inicio}:`);
  }
  assert.equal(await totalReservas(api), antes, "no se crea ninguna reserva, tampoco las de las semanas futuras");
  assert.deepEqual(await reservasDe(api, socio), []);
});
