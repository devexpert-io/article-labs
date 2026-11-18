// Tests ocultos de la spec `duraciones`: las reglas del club siguen (C10) y cancelar no cambia (C11), sea cual sea la
// duración. Lo de siempre se compara con la base: los tests "con las reservas de siempre" pasan también contra `club/`.
// Caja negra: solo la API HTTP, con /_estado (socios) y /_reloj para preparar. Cada prueba arranca su propia API, con la
// hora de Madrid (la del club).
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

/** Si la API se cuelga, el test falla a los 30 segundos y la API se cierra. */
const OPCIONES = { timeout: 30_000 };
/** Lunes 1 de febrero de 2027: toda la semana siguiente está libre (la semilla acaba el 24 de noviembre de 2026). */
const LUNES = "2027-02-01T10:00";
/** La hora de la semilla (sin AHORA): miércoles 18 de noviembre de 2026 a las 10:00. */
const SEMILLA = "2026-11-18T10:00";

interface Reserva {
  id: string;
  socioId: string;
  pistaId: string;
  inicio: string;
  estado: string;
  importe: number;
  penalizacion?: number;
}

async function conApi(t: TestContext, ahora: string, prueba: (api: Api) => Promise<void>): Promise<void> {
  const api = await arrancarApi({ TZ: "Europe/Madrid", AHORA: ahora });
  t.signal.addEventListener("abort", () => api.cerrar(), { once: true });
  try {
    await prueba(api);
  } finally {
    api.cerrar();
  }
}

/** Todas las reservas de GET /api/reservas con esa consulta, página a página. */
async function listarTodas(api: Api, consulta: string): Promise<Reserva[]> {
  const todas: Reserva[] = [];
  for (let pagina = 1; ; pagina++) {
    const r = await api.pedir("GET", `/api/reservas?${consulta}&limite=100&pagina=${pagina}`);
    assert.equal(r.status, 200, `GET /api/reservas?${consulta}: ${r.texto.slice(0, 300)}`);
    todas.push(...r.cuerpo.reservas);
    if (pagina >= r.cuerpo.paginas) return todas;
  }
}

/**
 * Socios para las pruebas: `conSitio` son los que tienen la cuota al día, no son gestores y no tienen reservas futuras
 * (cada uno puede hacer 3), y `sinCuota`, los que no tienen la cuota al día.
 */
async function socios(api: Api, ahora: string): Promise<{ conSitio: string[]; sinCuota: string[] }> {
  const todos: { id: string; cuotaActiva: boolean; rol: string }[] = (await api.pedir("GET", "/_estado")).cuerpo.socios;
  const conFuturas = new Set((await listarTodas(api, `desde=${ahora.slice(0, 10)}&estado=confirmada`)).filter((r) => r.inicio > ahora).map((r) => r.socioId));
  return {
    conSitio: todos.filter((s) => s.cuotaActiva === true && s.rol === "socio" && !conFuturas.has(s.id)).map((s) => s.id),
    sinCuota: todos.filter((s) => s.cuotaActiva === false).map((s) => s.id),
  };
}

/** Intenta crear la reserva (sin duracion si es undefined). */
function intentar(api: Api, socioId: string, pistaId: string, inicio: string, duracion?: number): Promise<Respuesta> {
  return api.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio, ...(duracion === undefined ? {} : { duracion }) } });
}

async function reservar(api: Api, socioId: string, pistaId: string, inicio: string, duracion?: number): Promise<Reserva> {
  const r = await intentar(api, socioId, pistaId, inicio, duracion);
  assert.equal(r.status, 201, `${socioId} ${pistaId} ${inicio} con ${duracion ?? "la duración por defecto"}: ${r.status} ${r.texto.slice(0, 300)}`);
  return r.cuerpo.reserva;
}

function esError(r: Respuesta, http: number, codigo: string, caso: string) {
  assert.equal(r.status, http, `${caso}: esperaba ${http} ${codigo} y llegó ${r.status}: ${r.texto.slice(0, 300)}`);
  assert.equal(r.cuerpo?.error?.codigo, codigo, `${caso}: ${r.texto.slice(0, 300)}`);
}

async function reloj(api: Api, ahora: string) {
  const r = await api.pedir("POST", "/_reloj", { cuerpo: { ahora } });
  assert.equal(r.status, 200, `mover el reloj a ${ahora}: ${r.texto}`);
}

/** Cancela como el socio de la reserva (en la base, cualquiera puede cancelar; así vale también si se mira X-Socio). */
function cancelar(api: Api, reserva: Reserva, cuerpo: Record<string, unknown> = {}): Promise<Respuesta> {
  return api.pedir("POST", `/api/reservas/${reserva.id}/cancelar`, { cuerpo, socio: reserva.socioId });
}

async function consultar(api: Api, reserva: Reserva): Promise<Reserva> {
  const r = await api.pedir("GET", `/api/reservas/${reserva.id}`);
  assert.equal(r.status, 200, r.texto.slice(0, 300));
  return r.cuerpo.reserva;
}

/** Comprueba que la respuesta de cancelar es un 200 con la reserva cancelada y la devuelve. */
function cancelada(r: Respuesta, caso: string): Reserva {
  assert.equal(r.status, 200, `${caso}: esperaba 200 al cancelar y llegó ${r.status}: ${r.texto.slice(0, 300)}`);
  assert.equal(r.cuerpo?.reserva?.estado, "cancelada", `${caso}: ${r.texto.slice(0, 300)}`);
  return r.cuerpo.reserva;
}

/** Sin penalización vale tanto sin el campo como con 0. */
function sinPenalizacion(reserva: Reserva, caso: string) {
  assert.equal(reserva.penalizacion ?? 0, 0, `${caso}: no debía tener penalización: ${JSON.stringify(reserva)}`);
}

// --- C10 · Las reglas del club siguen -----------------------------------------------------------------------------------

test("C10 · con las reservas de siempre, siguen la cuota al día, la pista cerrada, la reserva que ya ha empezado y las 3 reservas futuras", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  const { conSitio: [a, b, c], sinCuota } = await socios(api, LUNES);
  assert.ok(sinCuota.length > 0, "la semilla trae socios sin la cuota al día");
  for (const socio of sinCuota) esError(await intentar(api, socio, "pista-1", "2027-02-03T10:30"), 409, "CUOTA_INACTIVA", socio);
  esError(await intentar(api, a!, "pista-4", "2027-02-03T10:30"), 409, "PISTA_CERRADA", "pista 4");
  esError(await intentar(api, a!, "pista-1", "2027-02-01T09:00"), 409, "FRANJA_PASADA", "hoy a las 09:00");
  esError(await intentar(api, a!, "pista-2", "2027-01-29T18:00"), 409, "FRANJA_PASADA", "el viernes pasado");
  await reservar(api, b!, "pista-1", "2027-02-01T10:30"); // hoy, más tarde: sí
  await reservar(api, c!, "pista-1", "2027-02-03T10:30");
  await reservar(api, c!, "pista-2", "2027-02-04T12:00");
  await reservar(api, c!, "pista-3", "2027-02-05T18:00");
  esError(await intentar(api, c!, "pista-1", "2027-02-06T09:00"), 409, "LIMITE_DE_RESERVAS", "cuarta reserva futura");
}));

test("C10 · con 60 y 120 minutos también hace falta la cuota al día, la pista no puede estar cerrada y la reserva no puede haber empezado", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  const { conSitio: [a], sinCuota } = await socios(api, LUNES);
  for (const socio of sinCuota) {
    esError(await intentar(api, socio, "pista-1", "2027-02-03T10:00", 60), 409, "CUOTA_INACTIVA", `${socio} con 60`);
    esError(await intentar(api, socio, "pista-2", "2027-02-03T17:30", 120), 409, "CUOTA_INACTIVA", `${socio} con 120`);
  }
  esError(await intentar(api, a!, "pista-4", "2027-02-03T11:00", 120), 409, "PISTA_CERRADA", "pista 4 con 120");
  esError(await intentar(api, a!, "pista-4", "2027-02-03T09:30", 60), 409, "PISTA_CERRADA", "pista 4 con 60");
  await reloj(api, "2027-02-03T11:00");
  esError(await intentar(api, a!, "pista-1", "2027-02-03T11:00", 60), 409, "FRANJA_PASADA", "empieza ahora");
  esError(await intentar(api, a!, "pista-1", "2027-02-03T10:30", 120), 409, "FRANJA_PASADA", "empezó hace media hora y aún no ha terminado");
  esError(await intentar(api, a!, "pista-2", "2027-02-03T09:30", 60), 409, "FRANJA_PASADA", "esta mañana");
  esError(await intentar(api, a!, "pista-3", "2027-02-02T20:30", 120), 409, "FRANJA_PASADA", "ayer");
  await reservar(api, a!, "pista-1", "2027-02-03T11:30", 60); // dentro de media hora: sí
}));

test("C10 · el límite de 3 reservas futuras cuenta todas, sea cual sea su duración", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  const { conSitio: [d, e] } = await socios(api, LUNES);
  const corta = await reservar(api, d!, "pista-1", "2027-02-03T10:00", 60);
  await reservar(api, d!, "pista-2", "2027-02-04T17:00", 120);
  await reservar(api, d!, "pista-3", "2027-02-05T09:30");
  for (const duracion of [60, 90, 120, undefined]) {
    esError(await intentar(api, d!, "pista-1", "2027-02-06T11:00", duracion), 409, "LIMITE_DE_RESERVAS", `cuarta con ${duracion ?? "la duración por defecto"}`);
  }
  for (const hora of ["10:00", "12:00", "17:00"]) await reservar(api, e!, "pista-3", `2027-02-08T${hora}`, 60);
  esError(await intentar(api, e!, "pista-1", "2027-02-09T10:30"), 409, "LIMITE_DE_RESERVAS", "cuarta, de las de siempre, tras tres de 60");
  // Si cancela una, vuelve a tener sitio para otra.
  cancelada(await cancelar(api, corta), "cancelar la de 60");
  await reservar(api, d!, "pista-1", "2027-02-06T11:00", 60);
  esError(await intentar(api, d!, "pista-2", "2027-02-06T13:00", 120), 409, "LIMITE_DE_RESERVAS", "otra vez tres");
  // Cuando una ya ha terminado, deja de contar.
  await reloj(api, "2027-02-04T19:30");
  await reservar(api, d!, "pista-2", "2027-02-06T13:00", 120);
}));

// --- C11 · Cancelar no cambia ---------------------------------------------------------------------------------------

test("C11 · cancelar una reserva de siempre no cambia: gratis hasta 24 horas antes y, después, solo con forzar y con el 100 % del importe", OPCIONES, (t) => conApi(t, SEMILLA, async (api) => {
  // R-0520: Marta López, jueves 19 a las 09:00 en la pista 3 (faltan 23 horas).
  const marta = await consultar(api, { id: "R-0520" } as Reserva);
  esError(await cancelar(api, marta), 409, "FUERA_DE_PLAZO", "R-0520 sin forzar");
  const forzada = cancelada(await cancelar(api, marta, { forzar: true }), "R-0520 con forzar");
  assert.equal(forzada.penalizacion, marta.importe, "R-0520: la penalización es el importe");
  assert.equal(forzada.penalizacion, 1200);

  const { conSitio: [a, b, c] } = await socios(api, SEMILLA);
  const gratis = await reservar(api, a!, "pista-2", "2026-11-25T18:00");
  const tarde = await reservar(api, b!, "pista-1", "2026-11-25T19:30");
  const empezada = await reservar(api, c!, "pista-3", "2026-11-26T10:30");
  await reloj(api, "2026-11-24T18:00"); // faltan 24 horas justas
  sinPenalizacion(cancelada(await cancelar(api, gratis), "24 horas antes"), "24 horas antes");
  await reloj(api, "2026-11-24T19:31"); // faltan 23 horas y 59 minutos
  esError(await cancelar(api, tarde), 409, "FUERA_DE_PLAZO", "23 h 59 min antes, sin forzar");
  const penalizada = cancelada(await cancelar(api, tarde, { forzar: true }), "23 h 59 min antes, con forzar");
  assert.equal(penalizada.penalizacion, tarde.importe, "la penalización es el 100 % del importe");
  await reloj(api, "2026-11-26T10:30");
  esError(await cancelar(api, empezada), 409, "RESERVA_PASADA", "a la hora de inicio");
  esError(await cancelar(api, empezada, { forzar: true }), 409, "RESERVA_PASADA", "a la hora de inicio, con forzar");
}));

test("C11 · con 60, 90 o 120 minutos, cancelar es gratis hasta 24 horas antes del inicio", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  const { conSitio: [a, b, c] } = await socios(api, LUNES);
  const reservas: [Reserva, string][] = [
    [await reservar(api, a!, "pista-2", "2027-02-03T09:30", 90), "2027-02-02T09:30"],
    [await reservar(api, b!, "pista-1", "2027-02-03T17:30", 60), "2027-02-02T17:30"],
    [await reservar(api, c!, "pista-3", "2027-02-03T20:30", 120), "2027-02-02T20:30"],
  ];
  for (const [reserva, ahora] of reservas) {
    await reloj(api, ahora); // faltan 24 horas justas para su inicio
    const caso = `${reserva.pistaId} ${reserva.inicio}, 24 horas antes`;
    sinPenalizacion(cancelada(await cancelar(api, reserva), caso), caso);
    const guardada = await consultar(api, reserva);
    assert.equal(guardada.estado, "cancelada", caso);
    sinPenalizacion(guardada, caso);
  }
}));

test("C11 · a menos de 24 horas del inicio, solo con forzar y con una penalización del 100 % del importe, sea cual sea su duración", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  const { conSitio: [a, b, c] } = await socios(api, LUNES);
  const larga = await reservar(api, a!, "pista-1", "2027-02-03T17:00", 120); // cruza las 18:00
  const corta = await reservar(api, b!, "pista-2", "2027-02-03T18:30", 60);
  const media = await reservar(api, c!, "pista-3", "2027-02-03T11:00", 90);
  for (const [reserva, ahora] of [[larga, "2027-02-02T17:01"], [media, "2027-02-03T10:59"], [corta, "2027-02-03T12:00"]] as const) {
    await reloj(api, ahora);
    const caso = `${reserva.pistaId} ${reserva.inicio} con el reloj a ${ahora}`;
    esError(await cancelar(api, reserva), 409, "FUERA_DE_PLAZO", `${caso}, sin forzar`);
    esError(await cancelar(api, reserva, { forzar: false }), 409, "FUERA_DE_PLAZO", `${caso}, con forzar: false`);
    assert.equal((await consultar(api, reserva)).estado, "confirmada", `${caso}: sin forzar no se cancela`);
    const penalizada = cancelada(await cancelar(api, reserva, { forzar: true }), `${caso}, con forzar`);
    assert.equal(penalizada.penalizacion, reserva.importe, `${caso}: la penalización es el importe de la reserva`);
    const guardada = await consultar(api, reserva);
    assert.equal(guardada.estado, "cancelada", caso);
    assert.equal(guardada.penalizacion, reserva.importe, `${caso}, al consultarla`);
  }
}));

test("C11 · una reserva que ya ha empezado no se cancela (409 RESERVA_PASADA), dure lo que dure", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  const { conSitio: [a, b] } = await socios(api, LUNES);
  const dosHoras = await reservar(api, a!, "pista-1", "2027-02-03T10:00", 120); // 10:00-12:00
  const unaHora = await reservar(api, b!, "pista-2", "2027-02-03T11:30", 60); // 11:30-12:30
  for (const [ahora, reservas] of [["2027-02-03T10:00", [dosHoras]], ["2027-02-03T11:45", [dosHoras, unaHora]], ["2027-02-03T13:00", [dosHoras, unaHora]]] as const) {
    await reloj(api, ahora);
    for (const reserva of reservas) {
      esError(await cancelar(api, reserva), 409, "RESERVA_PASADA", `${reserva.inicio} con el reloj a ${ahora}`);
      esError(await cancelar(api, reserva, { forzar: true }), 409, "RESERVA_PASADA", `${reserva.inicio} con el reloj a ${ahora}, con forzar`);
    }
  }
  for (const reserva of [dosHoras, unaHora]) assert.equal((await consultar(api, reserva)).estado, "confirmada");
}));
