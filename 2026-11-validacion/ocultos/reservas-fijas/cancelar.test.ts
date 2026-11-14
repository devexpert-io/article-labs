// Tests ocultos de la spec `reservas-fijas`: cancelar la serie (C10) y cancelar una reserva suelta de la serie (C11).
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en test-ocultos/
// dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test. Cada prueba arranca su propia API.
// La spec no fija si canceladas y pendientes traen ids o reservas completas, ni su orden: se aceptan las dos formas y
// el estado de cada reserva se comprueba con GET /api/reservas/:id. Todas las fechas evitan los cambios de hora.
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

const ordenados = (lista: string[]) => [...lista].sort();

prueba("C10 · cancela sin penalización las reservas a las que les faltan 24 horas o más (canceladas) y deja confirmadas las de menos (pendientes)", async (api) => {
  const [socio] = await sociosAlDia(api, 1);
  const normal = await reservar(api, socio, "pista-3", "2027-01-08T12:00");
  const serie = await crearSerie(api, { socioId: socio, pistaId: "pista-1", inicio: "2027-01-05T10:30", semanas: 2 });
  const [primera, segunda] = (await reservasDe(api, socio)).filter((r) => r.id !== normal.id);
  await reloj(api, "2027-01-04T12:00"); // la primera empieza en 22,5 horas y la segunda, en 7 días y 22,5 horas
  const r = await cancelarSerie(api, serie);
  assert.equal(r.status, 200, r.texto);
  assert.ok(r.cuerpo?.serie && String(r.cuerpo.serie.id) === String(serie.id), `la respuesta trae la serie: ${r.texto}`);
  assert.deepEqual(ids(r.cuerpo.canceladas, "canceladas:"), [segunda.id]);
  assert.deepEqual(ids(r.cuerpo.pendientes, "pendientes:"), [primera.id]);
  const cancelada = await reserva(api, segunda.id);
  assert.equal(cancelada.estado, "cancelada");
  sinPenalizacion(cancelada);
  assert.equal((await reserva(api, primera.id)).estado, "confirmada", "la de menos de 24 horas sigue confirmada");
  assert.equal((await reserva(api, normal.id)).estado, "confirmada", "una reserva normal del socio no se toca");
});

prueba("C10 · con forzar: true también cancela las de menos de 24 horas, con la penalización de siempre (el 100 % de su importe), y las demás sin penalización", async (api) => {
  const [a, b] = await sociosAlDia(api, 2);
  // Una serie corta y una de 8 semanas, con descuento: la penalización es el 100 % del importe de la reserva, sea cual sea.
  const corta = await crearSerie(api, { socioId: a, pistaId: "pista-2", inicio: "2027-01-05T19:30", semanas: 3 });
  const larga = await crearSerie(api, { socioId: b, pistaId: "pista-1", inicio: "2027-01-05T19:30", semanas: 8 });
  await reloj(api, "2027-01-04T21:00"); // la primera semana de las dos empieza en 22,5 horas
  for (const [socio, serie] of [[a, corta], [b, larga]] as const) {
    const [primera, ...demas] = await reservasDe(api, socio);
    const r = await cancelarSerie(api, serie, { forzar: true });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(ordenados(ids(r.cuerpo.canceladas, "canceladas:")), ordenados([primera.id, ...demas.map((x) => x.id)]));
    assert.deepEqual(ids(r.cuerpo.pendientes, "pendientes:"), []);
    const forzada = await reserva(api, primera.id);
    assert.equal(forzada.estado, "cancelada");
    assert.equal(forzada.penalizacion, primera.importe, `el 100 % del importe de la reserva: ${JSON.stringify(forzada)}`);
    for (const x of demas) {
      const y = await reserva(api, x.id);
      assert.equal(y.estado, "cancelada");
      sinPenalizacion(y);
    }
  }
});

prueba("C10 · el límite es exacto: a 24 horas justas se cancela sin penalización y a 23 h 59 min queda pendiente", async (api) => {
  const [a, b] = await sociosAlDia(api, 2);
  const justa = await crearSerie(api, { socioId: a, pistaId: "pista-1", inicio: "2027-01-12T10:30", semanas: 2 });
  const casi = await crearSerie(api, { socioId: b, pistaId: "pista-2", inicio: "2027-01-12T10:30", semanas: 2 });
  const [a1, a2] = await reservasDe(api, a);
  const [b1, b2] = await reservasDe(api, b);

  await reloj(api, "2027-01-11T10:30");
  const ra = await cancelarSerie(api, justa);
  assert.equal(ra.status, 200, ra.texto);
  assert.deepEqual(ordenados(ids(ra.cuerpo.canceladas, "canceladas:")), ordenados([a1.id, a2.id]));
  assert.deepEqual(ids(ra.cuerpo.pendientes, "pendientes:"), []);
  const cancelada = await reserva(api, a1.id);
  assert.equal(cancelada.estado, "cancelada");
  sinPenalizacion(cancelada);

  await reloj(api, "2027-01-11T10:31");
  const rb = await cancelarSerie(api, casi);
  assert.equal(rb.status, 200, rb.texto);
  assert.deepEqual(ids(rb.cuerpo.canceladas, "canceladas:"), [b2.id]);
  assert.deepEqual(ids(rb.cuerpo.pendientes, "pendientes:"), [b1.id]);
  assert.equal((await reserva(api, b1.id)).estado, "confirmada");
});

prueba("C10 · no toca las reservas de la serie que ya han empezado (jugadas o en juego), tampoco con forzar", async (api) => {
  const [socio] = await sociosAlDia(api, 1);
  const serie = await crearSerie(api, { socioId: socio, pistaId: "pista-1", inicio: "2027-01-05T10:30", semanas: 3 });
  const [jugada, enJuego, futura] = await reservasDe(api, socio);
  await reloj(api, "2027-01-12T11:00"); // la primera se jugó hace una semana y la segunda empezó hace media hora
  const r = await cancelarSerie(api, serie, { forzar: true });
  assert.equal(r.status, 200, r.texto);
  assert.deepEqual(ids(r.cuerpo.canceladas, "canceladas:"), [futura.id]);
  for (const x of [jugada, enJuego]) {
    const y = await reserva(api, x.id);
    assert.equal(y.estado, "confirmada", `la que ya había empezado no se toca: ${JSON.stringify(y)}`);
    sinPenalizacion(y);
  }
  const cancelada = await reserva(api, futura.id);
  assert.equal(cancelada.estado, "cancelada");
  sinPenalizacion(cancelada);
});

prueba("C10 · no toca las reservas de la serie que ya estaban canceladas, tampoco con forzar", async (api) => {
  const [socio] = await sociosAlDia(api, 1);
  const serie = await crearSerie(api, { socioId: socio, pistaId: "pista-2", inicio: "2027-01-05T10:30", semanas: 3 });
  const [primera, segunda, tercera] = await reservasDe(api, socio);
  // Cancelar una reserva suelta es de C11: aquí solo se comprueba lo que pasa después, si se acepta.
  const sola = await api.pedir("POST", `/api/reservas/${primera.id}/cancelar`, { cuerpo: { motivo: "Viaje de trabajo" } });
  if (sola.status !== 200) return;
  await reloj(api, "2027-01-04T12:00"); // la primera (ya cancelada) empezaría en 22,5 horas: con forzar se penalizaría si se tocara
  const r = await cancelarSerie(api, serie, { forzar: true });
  assert.equal(r.status, 200, r.texto);
  assert.deepEqual(ordenados(ids(r.cuerpo.canceladas, "canceladas:")), ordenados([segunda.id, tercera.id]));
  const y = await reserva(api, primera.id);
  assert.deepEqual([y.estado, y.penalizacion ?? 0, y.motivoCancelacion], ["cancelada", 0, "Viaje de trabajo"], `la que ya estaba cancelada no se toca: ${JSON.stringify(y)}`);
});

prueba("C11 · una reserva de la serie se cancela sola por POST /api/reservas/:id/cancelar y la serie sigue con las demás", async (api) => {
  const [socio, otro] = await sociosAlDia(api, 2);
  const serie = await crearSerie(api, { socioId: socio, pistaId: "pista-3", inicio: "2027-01-06T12:00", semanas: 3 });
  const [primera, segunda, tercera] = await reservasDe(api, socio);
  const r = await api.pedir("POST", `/api/reservas/${segunda.id}/cancelar`, { cuerpo: {}, socio });
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.cuerpo?.reserva?.estado, "cancelada", r.texto);
  sinPenalizacion(r.cuerpo.reserva);
  for (const x of [primera, tercera]) assert.equal((await reserva(api, x.id)).estado, "confirmada", "las demás siguen confirmadas");

  const consulta = await api.pedir("GET", rutaSerie(serie), { socio: GESTOR });
  assert.equal(consulta.status, 200, `la serie sigue existiendo: ${consulta.texto}`);
  const enLaSerie = ids(consulta.cuerpo?.serie?.reservas, "reservas de la serie:");
  for (const x of [primera, tercera]) assert.ok(enLaSerie.includes(x.id), `la serie sigue con ${x.id}: ${consulta.texto}`);

  // La franja liberada se puede reservar como cualquier otra.
  const nueva = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: otro, pistaId: "pista-3", inicio: segunda.inicio } });
  assert.ok(nueva.status >= 200 && nueva.status < 300, `reservar la franja liberada: ${nueva.texto}`);
});

prueba("C11 · con las reglas de siempre: con menos de 24 horas, FUERA_DE_PLAZO sin forzar y el 100 % con forzar; luego YA_CANCELADA; y RESERVA_PASADA si ya ha empezado", async (api) => {
  const [socio] = await sociosAlDia(api, 1);
  const serie = await crearSerie(api, { socioId: socio, pistaId: "pista-1", inicio: "2027-01-05T18:00", semanas: 3 });
  const [primera, segunda, tercera] = await reservasDe(api, socio);
  const cancelar = (x: any, cuerpo: Record<string, unknown>) => api.pedir("POST", `/api/reservas/${x.id}/cancelar`, { cuerpo, socio });

  await reloj(api, "2027-01-04T19:30"); // la primera empieza en 22,5 horas
  esError(await cancelar(primera, {}), 409, "FUERA_DE_PLAZO", "sin forzar:");
  esError(await cancelar(primera, { forzar: false }), 409, "FUERA_DE_PLAZO", "con forzar: false:");
  assert.equal((await reserva(api, primera.id)).estado, "confirmada");
  const forzada = await cancelar(primera, { forzar: true });
  assert.equal(forzada.status, 200, forzada.texto);
  assert.equal(forzada.cuerpo?.reserva?.estado, "cancelada", forzada.texto);
  assert.equal(forzada.cuerpo.reserva.penalizacion, primera.importe, `el 100 % del importe: ${forzada.texto}`);
  esError(await cancelar(primera, { forzar: true }), 409, "YA_CANCELADA");

  await reloj(api, "2027-01-12T18:30"); // la segunda empezó hace media hora
  esError(await cancelar(segunda, {}), 409, "RESERVA_PASADA");
  esError(await cancelar(segunda, { forzar: true }), 409, "RESERVA_PASADA");
  assert.equal((await reserva(api, tercera.id)).estado, "confirmada", "la tercera sigue confirmada");
  assert.equal((await api.pedir("GET", rutaSerie(serie), { socio: GESTOR })).status, 200, "la serie sigue existiendo");
});
