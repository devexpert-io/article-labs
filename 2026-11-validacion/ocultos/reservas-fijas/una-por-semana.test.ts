// Tests ocultos de la spec `reservas-fijas`: una reserva por semana (C3), también cuando entre medias cambia la hora.
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en test-ocultos/
// dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test. Cada prueba arranca su propia API.
// Las del cambio de hora se repiten con la API en TZ=Europe/Madrid y en TZ=UTC: una implementación correcta da lo mismo con
// las dos, y así se cazan tanto las que suman 7 × 24 horas a una fecha local como las que dependen de la zona del sistema.
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

const resumen = (reservas: any[]) => reservas.map((r) => ({ pistaId: r.pistaId, inicio: r.inicio, fin: r.fin, estado: r.estado }));

/** El estado de una franja según GET /api/disponibilidad. */
async function estadoFranja(api: Api, pistaId: string, inicio: string): Promise<string> {
  const r = await api.pedir("GET", `/api/disponibilidad?fecha=${inicio.slice(0, 10)}&pista=${pistaId}`);
  assert.equal(r.status, 200, r.texto);
  const franja = r.cuerpo.pistas[0].franjas.find((f: any) => f.inicio === inicio);
  assert.ok(franja, `no existe la franja ${pistaId} ${inicio}`);
  return franja.estado;
}

for (const TZ of ["Europe/Madrid", "UTC"]) {
  prueba(`C3 · al pasar al horario de verano (28 de marzo de 2027) siguen a la misma hora local: martes 23 y 30 de marzo y 6 de abril a las 19:30 (TZ=${TZ})`, async (api) => {
    const [socio] = await sociosAlDia(api, 1);
    await crearSerie(api, { socioId: socio, pistaId: "pista-1", inicio: "2027-03-23T19:30", semanas: 3 });
    assert.deepEqual(resumen(await reservasDe(api, socio)), [
      { pistaId: "pista-1", inicio: "2027-03-23T19:30", fin: "2027-03-23T21:00", estado: "confirmada" },
      { pistaId: "pista-1", inicio: "2027-03-30T19:30", fin: "2027-03-30T21:00", estado: "confirmada" },
      { pistaId: "pista-1", inicio: "2027-04-06T19:30", fin: "2027-04-06T21:00", estado: "confirmada" },
    ]);
  }, { TZ, AHORA: "2027-03-01T10:00" });

  prueba(`C3 · al volver al horario de invierno (31 de octubre de 2027) también: martes 26 de octubre y 2 y 9 de noviembre a las 09:00 (TZ=${TZ})`, async (api) => {
    const [socio] = await sociosAlDia(api, 1);
    await crearSerie(api, { socioId: socio, pistaId: "pista-3", inicio: "2027-10-26T09:00", semanas: 3 });
    assert.deepEqual(resumen(await reservasDe(api, socio)), [
      { pistaId: "pista-3", inicio: "2027-10-26T09:00", fin: "2027-10-26T10:30", estado: "confirmada" },
      { pistaId: "pista-3", inicio: "2027-11-02T09:00", fin: "2027-11-02T10:30", estado: "confirmada" },
      { pistaId: "pista-3", inicio: "2027-11-09T09:00", fin: "2027-11-09T10:30", estado: "confirmada" },
    ]);
  }, { TZ, AHORA: "2027-10-01T10:00" });
}

prueba("C3 · una serie de N semanas crea N reservas confirmadas del socio, cada 7 días y en la misma pista, que ocupan sus franjas", async (api) => {
  const [socio, otro] = await sociosAlDia(api, 2);
  await crearSerie(api, { socioId: socio, pistaId: "pista-2", inicio: "2027-01-06T16:30", semanas: 3 });
  const esperadas = ["2027-01-06T16:30", "2027-01-13T16:30", "2027-01-20T16:30"];
  const reservas = await reservasDe(api, socio);
  assert.deepEqual(resumen(reservas), esperadas.map((inicio) => ({ pistaId: "pista-2", inicio, fin: `${inicio.slice(0, 11)}18:00`, estado: "confirmada" })));
  for (const r of reservas) assert.equal(r.socioId, socio);
  for (const inicio of esperadas) {
    assert.equal(await estadoFranja(api, "pista-2", inicio), "reservada", `la franja ${inicio} queda reservada`);
    esError(await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: otro, pistaId: "pista-2", inicio } }), 409, "FRANJA_NO_DISPONIBLE", inicio);
  }
  assert.equal(await estadoFranja(api, "pista-2", "2027-01-27T16:30"), "libre", "la serie no reserva una semana de más");
});

prueba("C3 · con 2 semanas, dos reservas: la de inicio y la de 7 días después", async (api) => {
  const [socio] = await sociosAlDia(api, 1);
  await crearSerie(api, { socioId: socio, pistaId: "pista-3", inicio: "2027-01-10T21:00", semanas: 2 });
  assert.deepEqual(resumen(await reservasDe(api, socio)), [
    { pistaId: "pista-3", inicio: "2027-01-10T21:00", fin: "2027-01-10T22:30", estado: "confirmada" },
    { pistaId: "pista-3", inicio: "2027-01-17T21:00", fin: "2027-01-17T22:30", estado: "confirmada" },
  ]);
});
