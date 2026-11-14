// Tests ocultos de la spec `reservas-fijas`: permisos (C1).
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

const SERIE = { pistaId: "pista-1", inicio: "2027-01-05T10:30", semanas: 3 };

prueba("C1 · sin X-Socio, crear, consultar y cancelar una serie dan 401 NO_IDENTIFICADO", async (api) => {
  const [socio] = await sociosAlDia(api, 1);
  const antes = await totalReservas(api);
  esError(await pedirSerie(api, { socioId: socio, ...SERIE }, null), 401, "NO_IDENTIFICADO", "POST /api/series sin X-Socio:");
  assert.equal(await totalReservas(api), antes, "sin X-Socio no se crea ninguna reserva");

  const serie = await crearSerie(api, { socioId: socio, ...SERIE });
  esError(await api.pedir("GET", rutaSerie(serie)), 401, "NO_IDENTIFICADO", "GET /api/series/:id sin X-Socio:");
  esError(await api.pedir("POST", `${rutaSerie(serie)}/cancelar`, { cuerpo: {} }), 401, "NO_IDENTIFICADO", "cancelar sin X-Socio:");
  esError(await api.pedir("POST", `${rutaSerie(serie)}/cancelar`, { cuerpo: { forzar: true } }), 401, "NO_IDENTIFICADO", "cancelar con forzar sin X-Socio:");
  const reservas = await reservasDe(api, socio);
  assert.ok(reservas.length > 0, "la serie del gestor tiene reservas");
  for (const r of reservas) assert.equal(r.estado, "confirmada", `sin X-Socio no se cancela nada: ${JSON.stringify(r)}`);

  // El gestor sí puede.
  assert.equal((await api.pedir("GET", rutaSerie(serie), { socio: GESTOR })).status, 200, "el gestor consulta la serie");
  assert.equal((await cancelarSerie(api, serie)).status, 200, "el gestor cancela la serie");
});

prueba("C1 · con un socio que no es gestor (también el de la serie), crear, consultar y cancelar una serie dan 403 SIN_PERMISO", async (api) => {
  const [socio, otro] = await sociosAlDia(api, 2);
  const moroso = await socioSinCuota(api);
  const antes = await totalReservas(api);
  for (const quien of [socio, otro, moroso]) {
    esError(await pedirSerie(api, { socioId: socio, ...SERIE }, quien), 403, "SIN_PERMISO", `POST /api/series como ${quien}:`);
  }
  assert.equal(await totalReservas(api), antes, "un socio que no es gestor no crea ninguna reserva");

  const serie = await crearSerie(api, { socioId: socio, ...SERIE });
  await reloj(api, "2027-01-04T12:00"); // la primera semana empieza en 22,5 horas: con forzar se cancelaría todo
  for (const quien of [socio, otro]) {
    esError(await api.pedir("GET", rutaSerie(serie), { socio: quien }), 403, "SIN_PERMISO", `GET /api/series/:id como ${quien}:`);
    esError(await api.pedir("POST", `${rutaSerie(serie)}/cancelar`, { cuerpo: {}, socio: quien }), 403, "SIN_PERMISO", `cancelar como ${quien}:`);
    esError(await api.pedir("POST", `${rutaSerie(serie)}/cancelar`, { cuerpo: { forzar: true }, socio: quien }), 403, "SIN_PERMISO", `cancelar con forzar como ${quien}:`);
  }
  const reservas = await reservasDe(api, socio);
  assert.ok(reservas.length > 0, "la serie del gestor tiene reservas");
  for (const r of reservas) {
    assert.equal(r.estado, "confirmada", `un socio que no es gestor no cancela nada: ${JSON.stringify(r)}`);
    sinPenalizacion(r);
  }

  // El gestor sí puede.
  assert.equal((await api.pedir("GET", rutaSerie(serie), { socio: GESTOR })).status, 200, "el gestor consulta la serie");
  assert.equal((await cancelarSerie(api, serie)).status, 200, "el gestor cancela la serie");
});
