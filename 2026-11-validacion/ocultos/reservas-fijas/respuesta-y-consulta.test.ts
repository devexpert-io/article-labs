// Tests ocultos de la spec `reservas-fijas`: respuesta de POST /api/series (C8) y consulta con GET /api/series/:id (C9).
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en test-ocultos/
// dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test. Cada prueba arranca su propia API.
// El id de la serie puede ser un texto o un número: la spec no fija su forma. Se admiten campos extra.
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

function idValido(id: unknown): boolean {
  return (typeof id === "string" && id !== "") || (typeof id === "number" && Number.isFinite(id));
}

prueba("C8 · POST /api/series responde 201 { serie } con id, socioId, pistaId, inicio, semanas, reservas (los ids, por orden de fecha) y saltadas", async (api) => {
  const [socio] = await sociosAlDia(api, 1);
  const pedida = { socioId: socio, pistaId: "pista-1", inicio: "2027-01-05T10:30", semanas: 3 };
  const r = await pedirSerie(api, pedida);
  assert.equal(r.status, 201, r.texto);
  const serie = r.cuerpo?.serie;
  assert.ok(serie && typeof serie === "object", `la respuesta es { serie }: ${r.texto}`);
  assert.ok(idValido(serie.id), `la serie trae id: ${r.texto}`);
  assert.deepEqual({ socioId: serie.socioId, pistaId: serie.pistaId, inicio: serie.inicio, semanas: serie.semanas }, pedida);
  const creadas = await reservasDe(api, socio);
  assert.equal(creadas.length, 3, "la serie ha creado sus 3 reservas");
  assert.deepEqual(serie.reservas, creadas.map((x) => x.id), "reservas son los ids de las reservas creadas, por orden de fecha");
  assert.deepEqual(serie.saltadas, [], "sin semanas saltadas, saltadas es una lista vacía");
});

prueba("C8 · cada reserva creada lleva serieId, el id de su serie", async (api) => {
  const [a, b, c] = await sociosAlDia(api, 3);
  const normal = await reservar(api, c, "pista-1", "2027-01-08T10:30"); // la misma pista y hora, otro día: no es de ninguna serie
  const primera = await crearSerie(api, { socioId: a, pistaId: "pista-1", inicio: "2027-01-05T10:30", semanas: 3 });
  const segunda = await crearSerie(api, { socioId: b, pistaId: "pista-2", inicio: "2027-01-05T10:30", semanas: 2 });
  assert.notEqual(String(primera.id), String(segunda.id), "cada serie tiene su id");
  for (const [socio, serie, cuantas] of [[a, primera, 3], [b, segunda, 2]] as const) {
    const deLaSerie = await reservasDe(api, socio);
    assert.equal(deLaSerie.length, cuantas, `las reservas de la serie ${serie.id}`);
    for (const r of deLaSerie) {
      assert.ok(r.serieId !== undefined && r.serieId !== null, `la reserva ${r.id} lleva serieId: ${JSON.stringify(r)}`);
      assert.equal(String(r.serieId), String(serie.id), `serieId de ${r.id} en GET /api/reservas`);
      assert.equal(String((await reserva(api, r.id)).serieId), String(serie.id), `serieId de ${r.id} en GET /api/reservas/:id`);
    }
  }
  const sigueNormal = await reserva(api, normal.id);
  assert.ok(sigueNormal.serieId === undefined || sigueNormal.serieId === null, `una reserva normal no es de ninguna serie: ${JSON.stringify(sigueNormal)}`);
});

prueba("C9 · GET /api/series/:id devuelve { serie } con sus datos y sus reservas completas, por orden de fecha", async (api) => {
  const [socio, otro] = await sociosAlDia(api, 2);
  await reservar(api, otro, "pista-1", "2027-01-05T12:00"); // la misma pista, otra hora: no es de la serie
  const creada = await crearSerie(api, { socioId: socio, pistaId: "pista-1", inicio: "2027-01-05T10:30", semanas: 3 });
  const r = await api.pedir("GET", rutaSerie(creada), { socio: GESTOR });
  assert.equal(r.status, 200, r.texto);
  const serie = r.cuerpo?.serie;
  assert.ok(serie && typeof serie === "object", `la respuesta es { serie }: ${r.texto}`);
  assert.equal(String(serie.id), String(creada.id));
  assert.deepEqual(
    { socioId: serie.socioId, pistaId: serie.pistaId, inicio: serie.inicio, semanas: serie.semanas },
    { socioId: socio, pistaId: "pista-1", inicio: "2027-01-05T10:30", semanas: 3 },
  );
  assert.deepEqual(serie.saltadas, [], "sin semanas saltadas, saltadas es una lista vacía");

  const esperadas = await reservasDe(api, socio);
  assert.equal(esperadas.length, 3);
  assert.ok(Array.isArray(serie.reservas), `reservas es una lista: ${r.texto}`);
  assert.ok(serie.reservas.every((x: unknown) => x !== null && typeof x === "object"), `reservas trae las reservas completas, no los ids: ${r.texto}`);
  assert.deepEqual(serie.reservas.map((x: any) => x.id), esperadas.map((x) => x.id), "las reservas de la serie, por orden de fecha");
  for (const [i, completa] of serie.reservas.entries()) {
    const sola = await reserva(api, esperadas[i].id);
    for (const [campo, valor] of Object.entries(sola)) assert.deepEqual(completa[campo], valor, `${campo} de la reserva ${sola.id}`);
  }
});

prueba("C9 · si la serie no existe, 404 SERIE_NO_ENCONTRADA", async (api) => {
  const [socio] = await sociosAlDia(api, 1);
  esError(await api.pedir("GET", "/api/series/S-0001", { socio: GESTOR }), 404, "SERIE_NO_ENCONTRADA", "antes de crear ninguna:");
  await crearSerie(api, { socioId: socio, pistaId: "pista-1", inicio: "2027-01-05T10:30", semanas: 2 });
  for (const id of ["no-existe", "S-9999", "999999"]) {
    esError(await api.pedir("GET", `/api/series/${id}`, { socio: GESTOR }), 404, "SERIE_NO_ENCONTRADA", `GET /api/series/${id}:`);
  }
});
