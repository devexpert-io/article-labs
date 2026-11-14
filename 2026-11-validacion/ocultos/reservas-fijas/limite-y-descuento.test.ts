// Tests ocultos de la spec `reservas-fijas`: fuera del límite de 3 (C6) y descuento (C7).
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en test-ocultos/
// dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test. Cada prueba arranca su propia API.
// Todos los precios de la semilla son múltiplos de 100 céntimos, así que el 10 % de descuento siempre sale exacto: el
// redondeo hacia abajo no se puede distinguir de otros por la API.
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

/** El precio normal de una franja según GET /api/disponibilidad. */
async function precioNormal(api: Api, pistaId: string, inicio: string): Promise<number> {
  const r = await api.pedir("GET", `/api/disponibilidad?fecha=${inicio.slice(0, 10)}&pista=${pistaId}`);
  assert.equal(r.status, 200, r.texto);
  const franja = r.cuerpo.pistas[0].franjas.find((f: any) => f.inicio === inicio);
  assert.ok(franja && Number.isInteger(franja.precio), `no hay precio para ${pistaId} ${inicio}: ${r.texto}`);
  return franja.precio;
}

prueba("C6 · la serie se crea entera aunque el socio ya tenga 3 reservas futuras", async (api) => {
  const [socio] = await sociosAlDia(api, 1);
  for (const dia of ["05", "06", "07"]) await reservar(api, socio, "pista-3", `2027-01-${dia}T12:00`);
  await crearSerie(api, { socioId: socio, pistaId: "pista-1", inicio: "2027-01-05T10:30", semanas: 4 });
  const deLaSerie = (await reservasDe(api, socio)).filter((r) => r.pistaId === "pista-1");
  assert.deepEqual(deLaSerie.map((r) => [r.inicio, r.estado]), [
    ["2027-01-05T10:30", "confirmada"],
    ["2027-01-12T10:30", "confirmada"],
    ["2027-01-19T10:30", "confirmada"],
    ["2027-01-26T10:30", "confirmada"],
  ]);
});

prueba("C6 · las reservas de la serie no impiden al socio hacer sus 3 reservas normales; la cuarta normal sigue dando LIMITE_DE_RESERVAS", async (api) => {
  const [socio] = await sociosAlDia(api, 1);
  await crearSerie(api, { socioId: socio, pistaId: "pista-2", inicio: "2027-01-05T10:30", semanas: 5 });
  for (const dia of ["06", "07", "08"]) {
    const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: socio, pistaId: "pista-3", inicio: `2027-01-${dia}T13:30` } });
    assert.ok(r.status >= 200 && r.status < 300, `reserva normal del día ${dia} con la serie en marcha: ${r.status} ${r.texto}`);
  }
  esError(await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: socio, pistaId: "pista-3", inicio: "2027-01-11T13:30" } }), 409, "LIMITE_DE_RESERVAS", "cuarta reserva normal:");
});

prueba("C7 · en una serie de 8 semanas o más, cada reserva cuesta un 10 % menos que su precio normal", async (api) => {
  const [a, b, c] = await sociosAlDia(api, 3);
  const casos = [
    { socioId: a, pistaId: "pista-2", inicio: "2027-01-07T19:30", semanas: 8 }, // jueves por la tarde: punta
    { socioId: b, pistaId: "pista-3", inicio: "2027-01-05T12:00", semanas: 8 }, // martes a mediodía: valle
    { socioId: c, pistaId: "pista-1", inicio: "2027-01-09T10:30", semanas: 10 }, // sábado: punta
  ];
  for (const caso of casos) {
    const normal = await precioNormal(api, caso.pistaId, caso.inicio);
    await crearSerie(api, caso);
    const reservas = await reservasDe(api, caso.socioId);
    assert.ok(reservas.length > 0, `la serie ${JSON.stringify(caso)} tiene reservas`);
    for (const r of reservas) {
      assert.equal(r.importe, Math.floor((normal * 90) / 100), `${caso.semanas} semanas, precio normal ${normal}: ${JSON.stringify(r)}`);
    }
  }
});

prueba("C7 · con menos de 8 semanas, cada reserva cuesta su precio normal", async (api) => {
  const [a, b] = await sociosAlDia(api, 2);
  const casos = [
    { socioId: a, pistaId: "pista-2", inicio: "2027-01-07T19:30", semanas: 7 }, // punta
    { socioId: b, pistaId: "pista-3", inicio: "2027-01-05T12:00", semanas: 2 }, // valle
  ];
  for (const caso of casos) {
    const normal = await precioNormal(api, caso.pistaId, caso.inicio);
    await crearSerie(api, caso);
    const reservas = await reservasDe(api, caso.socioId);
    assert.ok(reservas.length > 0, `la serie ${JSON.stringify(caso)} tiene reservas`);
    for (const r of reservas) assert.equal(r.importe, normal, `${caso.semanas} semanas: ${JSON.stringify(r)}`);
  }
});
