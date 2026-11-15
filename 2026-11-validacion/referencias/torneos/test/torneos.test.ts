// Los torneos (docs/specs/torneos.md), probados a través de la API.
// Cada prueba arranca su propia API con la hora de la semilla (miércoles 18 de noviembre de 2026 a las 10:00). Los
// torneos se juegan el sábado 28 y el domingo 29, que no tienen reservas en la semilla.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

const GESTOR = "socio-040";
/** Las cuatro franjas seguidas del sábado 28 por la mañana. */
const SABADO = ["2026-11-28T09:00", "2026-11-28T10:30", "2026-11-28T12:00", "2026-11-28T13:30"];
const DATOS = { nombre: "Open de otoño", pistas: ["pista-1", "pista-2"], franjas: SABADO, plazas: 8, cuota: 2000 };
/** Socios con la cuota al día: en la semilla no la tienen socio-011, socio-022 ni socio-033, y socio-040 es la recepción. */
const JUGADORES = Array.from({ length: 41 }, (_, i) => `socio-${String(i + 1).padStart(3, "0")}`)
  .filter((id) => !["socio-011", "socio-022", "socio-033", "socio-040"].includes(id));

const abiertas = new Set<Api>();
after(() => abiertas.forEach((api) => api.cerrar()));

async function conApi(prueba: (api: Api) => Promise<void>, entorno: Record<string, string> = {}) {
  const api = await arrancarApi(entorno);
  abiertas.add(api);
  try {
    await prueba(api);
  } finally {
    api.cerrar();
    abiertas.delete(api);
  }
}

function esError(r: Respuesta, http: number, codigo: string) {
  assert.equal(r.status, http, r.texto);
  assert.equal(r.cuerpo.error.codigo, codigo, r.texto);
}

async function reloj(api: Api, ahora: string) {
  assert.equal((await api.pedir("POST", "/_reloj", { cuerpo: { ahora } })).status, 200);
}

/** Pide crear un torneo como `socio` (el gestor si no se dice; null, sin cabecera X-Socio). */
const pedirTorneo = (api: Api, cuerpo: Record<string, unknown>, socio: string | null = GESTOR) =>
  api.pedir("POST", "/api/torneos", { cuerpo, socio: socio ?? undefined });

async function crearTorneo(api: Api, cambios: Record<string, unknown> = {}) {
  const r = await pedirTorneo(api, { ...DATOS, ...cambios });
  assert.equal(r.status, 201, r.texto);
  return r.cuerpo.torneo;
}

async function verTorneo(api: Api, id: string) {
  const r = await api.pedir("GET", `/api/torneos/${id}`);
  assert.equal(r.status, 200, r.texto);
  return r.cuerpo.torneo;
}

/** Pide inscribir a una pareja como `quien` (el primero de la pareja si no se dice; null, sin cabecera X-Socio). */
const pedirInscripcion = (api: Api, torneoId: string, socios: unknown, quien: string | null = GESTOR) =>
  api.pedir("POST", `/api/torneos/${torneoId}/inscripciones`, { cuerpo: { socios }, socio: quien ?? undefined });

async function inscribir(api: Api, torneoId: string, socios: [string, string], quien: string = socios[0]) {
  const r = await pedirInscripcion(api, torneoId, socios, quien);
  assert.equal(r.status, 201, r.texto);
  return r.cuerpo.inscripcion;
}

/** Inscribe `n` parejas con los jugadores de `desde` en adelante, por orden. */
async function inscribirParejas(api: Api, torneoId: string, n: number, desde = 0) {
  const inscripciones = [];
  for (let k = 0; k < n; k++) {
    inscripciones.push(await inscribir(api, torneoId, [JUGADORES[desde + 2 * k]!, JUGADORES[desde + 2 * k + 1]!]));
  }
  return inscripciones;
}

const pedirBaja = (api: Api, torneoId: string, inscripcionId: string, quien: string | null = GESTOR) =>
  api.pedir("POST", `/api/torneos/${torneoId}/inscripciones/${inscripcionId}/baja`, { socio: quien ?? undefined });

const pedirCierre = (api: Api, torneoId: string, quien: string | null = GESTOR) =>
  api.pedir("POST", `/api/torneos/${torneoId}/cerrar`, { socio: quien ?? undefined });

async function cerrar(api: Api, torneoId: string) {
  const r = await pedirCierre(api, torneoId);
  assert.equal(r.status, 200, r.texto);
  return r.cuerpo.torneo;
}

/** Un torneo con `n` parejas inscritas y la inscripción cerrada. */
async function torneoEnJuego(api: Api, n: number, cambios: Record<string, unknown> = {}) {
  const t = await crearTorneo(api, cambios);
  const inscripciones = await inscribirParejas(api, t.id, n);
  return { torneo: await cerrar(api, t.id), inscripciones };
}

const apuntar = (api: Api, torneoId: string, partidoId: string, cuerpo: Record<string, unknown>, quien: string | null = GESTOR) =>
  api.pedir("POST", `/api/torneos/${torneoId}/partidos/${partidoId}/resultado`, { cuerpo, socio: quien ?? undefined });

async function apuntarBien(api: Api, torneoId: string, partidoId: string, cuerpo: Record<string, unknown>) {
  const r = await apuntar(api, torneoId, partidoId, cuerpo);
  assert.equal(r.status, 200, r.texto);
  return r.cuerpo.partido;
}

const pedirCancelacion = (api: Api, torneoId: string, quien: string | null = GESTOR) =>
  api.pedir("POST", `/api/torneos/${torneoId}/cancelar`, { socio: quien ?? undefined });

/** La franja de `inicio` en la pista `pistaId`, tal como sale en la disponibilidad. */
async function franja(api: Api, pistaId: string, inicio: string) {
  const r = await api.pedir("GET", `/api/disponibilidad?fecha=${inicio.slice(0, 10)}&pista=${pistaId}`);
  assert.equal(r.status, 200, r.texto);
  return r.cuerpo.pistas[0].franjas.find((f: any) => f.inicio === inicio);
}

async function reservar(api: Api, socioId: string, pistaId: string, inicio: string) {
  return api.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio } });
}

/**
 * Los partidos de un torneo para compararlos: [ronda, numero, pareja, pareja, estado, ganadora, pistaId, inicio], con
 * cada pareja como su número en el cuadro (las inscripciones `inscrita`, por orden de inscripción, desde 1).
 */
function cuadro(torneo: any) {
  const numeros = new Map(torneo.inscripciones.filter((i: any) => i.estado === "inscrita").map((i: any, k: number) => [i.id, k + 1]));
  const n = (id: string | null) => (id === null ? null : numeros.get(id));
  return torneo.partidos.map((p: any) => [p.ronda, p.numero, n(p.parejas[0]), n(p.parejas[1]), p.estado, n(p.ganadora), p.pistaId, p.inicio]);
}

test("permisos: crear, cerrar y cancelar torneos y apuntar resultados, solo un gestor", () => conApi(async (api) => {
  esError(await pedirTorneo(api, DATOS, null), 401, "NO_IDENTIFICADO");
  esError(await pedirTorneo(api, DATOS, "socio-003"), 403, "SIN_PERMISO");
  assert.deepEqual((await api.pedir("GET", "/api/torneos")).cuerpo.torneos, []);
  const t = await crearTorneo(api);
  const [a] = await inscribirParejas(api, t.id, 2);
  for (const pedir of [pedirCierre, pedirCancelacion]) {
    esError(await pedir(api, t.id, null), 401, "NO_IDENTIFICADO");
    esError(await pedir(api, t.id, JUGADORES[0]!), 403, "SIN_PERMISO");
  }
  assert.equal((await verTorneo(api, t.id)).estado, "inscripcion");
  const [final] = (await cerrar(api, t.id)).partidos;
  await reloj(api, final.inicio);
  esError(await apuntar(api, t.id, final.id, { ganadora: a.id }, null), 401, "NO_IDENTIFICADO");
  esError(await apuntar(api, t.id, final.id, { ganadora: a.id }, JUGADORES[0]!), 403, "SIN_PERMISO");
  const despues = await verTorneo(api, t.id);
  assert.deepEqual([despues.estado, despues.partidos[0].estado], ["en_juego", "pendiente"]);
  assert.equal((await pedirCancelacion(api, t.id)).status, 200);
}));

test("permisos: inscribe o da de baja a una pareja uno de sus dos socios o un gestor, y consultar es libre", () => conApi(async (api) => {
  const t = await crearTorneo(api);
  esError(await pedirInscripcion(api, t.id, ["socio-001", "socio-002"], null), 401, "NO_IDENTIFICADO");
  esError(await pedirInscripcion(api, t.id, ["socio-001", "socio-002"], "socio-003"), 403, "SIN_PERMISO");
  assert.deepEqual((await verTorneo(api, t.id)).inscripciones, []);
  const porElPrimero = await inscribir(api, t.id, ["socio-001", "socio-002"], "socio-001");
  const porElSegundo = await inscribir(api, t.id, ["socio-003", "socio-004"], "socio-004");
  const porElGestor = await inscribir(api, t.id, ["socio-005", "socio-006"], GESTOR);
  esError(await pedirBaja(api, t.id, porElPrimero.id, null), 401, "NO_IDENTIFICADO");
  esError(await pedirBaja(api, t.id, porElPrimero.id, "socio-003"), 403, "SIN_PERMISO");
  assert.equal((await verTorneo(api, t.id)).inscripciones[0].estado, "inscrita");
  assert.equal((await pedirBaja(api, t.id, porElPrimero.id, "socio-002")).status, 200);
  assert.equal((await pedirBaja(api, t.id, porElSegundo.id, "socio-003")).status, 200);
  assert.equal((await pedirBaja(api, t.id, porElGestor.id, GESTOR)).status, 200);
  const lista = await api.pedir("GET", "/api/torneos");
  assert.equal(lista.status, 200, lista.texto);
  assert.deepEqual(lista.cuerpo.torneos.map((x: any) => x.id), [t.id]);
  const uno = await api.pedir("GET", `/api/torneos/${t.id}`);
  assert.equal(uno.status, 200, uno.texto);
  assert.deepEqual(uno.cuerpo.torneo.inscripciones.map((i: any) => i.estado), ["baja", "baja", "baja"]);
}));

test("datos del torneo: nombre, pistas y franjas sin repetidos, plazas de 4 a 16, cuota de 0 o más y franjas válidas que no han empezado", () => conApi(async (api) => {
  const malos: Record<string, unknown>[] = [
    { nombre: "" }, { nombre: "   " }, { nombre: 7 }, { nombre: undefined },
    { pistas: [] }, { pistas: "pista-1" }, { pistas: ["pista-1", "pista-1"] }, { pistas: undefined },
    { franjas: [] }, { franjas: "2026-11-28T09:00" }, { franjas: ["2026-11-28T09:00", "2026-11-28T09:00"] }, { franjas: undefined },
    { plazas: 3 }, { plazas: 17 }, { plazas: 8.5 }, { plazas: "8" }, { plazas: undefined },
    { cuota: -1 }, { cuota: 12.5 }, { cuota: "2000" }, { cuota: undefined },
  ];
  for (const cambio of malos) esError(await pedirTorneo(api, { ...DATOS, ...cambio }), 400, "DATOS_INVALIDOS");
  esError(await pedirTorneo(api, { ...DATOS, pistas: ["pista-1", "pista-9"] }), 404, "PISTA_NO_ENCONTRADA");
  for (const mala of ["2026-11-28T10:00", "2026-11-28", "28/11/2026 09:00", "2026-11-31T09:00", 20261128]) {
    esError(await pedirTorneo(api, { ...DATOS, franjas: ["2026-11-28T09:00", mala] }), 400, "FRANJA_INVALIDA");
  }
  esError(await pedirTorneo(api, { ...DATOS, franjas: ["2026-11-28T09:00", "2026-11-18T09:00"] }), 409, "FRANJA_PASADA");
  await reloj(api, "2026-11-28T10:30");
  esError(await pedirTorneo(api, { ...DATOS, franjas: ["2026-11-28T10:30", "2026-11-28T12:00"] }), 409, "FRANJA_PASADA");
  assert.deepEqual((await api.pedir("GET", "/api/torneos")).cuerpo.torneos, []);
  await crearTorneo(api, { plazas: 4, cuota: 0, franjas: ["2026-11-28T12:00"] });
  await crearTorneo(api, { plazas: 16, pistas: ["pista-3"], franjas: ["2026-11-28T12:00"] });
}));

test("pistas libres: con una pista cerrada o franjas ocupadas no se crea nada, y FRANJAS_OCUPADAS trae los conflictos", () => conApi(async (api) => {
  esError(await pedirTorneo(api, { ...DATOS, pistas: ["pista-1", "pista-4"] }), 409, "PISTA_CERRADA");
  const reserva = (await reservar(api, "socio-003", "pista-2", "2026-11-28T10:30")).cuerpo.reserva;
  const cancelada = (await reservar(api, "socio-006", "pista-1", "2026-11-28T09:00")).cuerpo.reserva;
  assert.equal((await api.pedir("POST", `/api/reservas/${cancelada.id}/cancelar`)).status, 200);
  const otro = await crearTorneo(api, { nombre: "Americano", pistas: ["pista-3", "pista-1"], franjas: ["2026-11-28T12:00"] });
  const descartado = await crearTorneo(api, { nombre: "Suspendido", pistas: ["pista-2"], franjas: ["2026-11-28T13:30"] });
  assert.equal((await pedirCancelacion(api, descartado.id)).status, 200);
  const r = await pedirTorneo(api, DATOS);
  esError(r, 409, "FRANJAS_OCUPADAS");
  assert.deepEqual(r.cuerpo.error.conflictos, [
    { pistaId: "pista-2", inicio: "2026-11-28T10:30", reservaId: reserva.id },
    { pistaId: "pista-1", inicio: "2026-11-28T12:00", torneoId: otro.id },
  ]);
  assert.deepEqual((await api.pedir("GET", "/api/torneos")).cuerpo.torneos.map((t: any) => t.id), [otro.id, descartado.id]);
  assert.equal((await franja(api, "pista-1", "2026-11-28T09:00")).estado, "libre");
  // Sin esas dos franjas, se crea: la reserva cancelada y el torneo cancelado no chocan.
  const t = await crearTorneo(api, { franjas: ["2026-11-28T09:00", "2026-11-28T13:30"] });
  assert.equal(t.estado, "inscripcion");
}));

test("crear y consultar: 201 con el torneo en inscripción y GET con sus inscripciones y sus partidos", () => conApi(async (api) => {
  const r = await pedirTorneo(api, { nombre: "Open de otoño", pistas: ["pista-2", "pista-1"], franjas: ["2026-11-28T12:00", "2026-11-28T09:00"], plazas: 6, cuota: 1500 });
  assert.equal(r.status, 201, r.texto);
  const t = r.cuerpo.torneo;
  assert.equal(typeof t.id, "string");
  assert.deepEqual(t, {
    id: t.id, nombre: "Open de otoño", pistas: ["pista-2", "pista-1"], franjas: ["2026-11-28T09:00", "2026-11-28T12:00"],
    plazas: 6, cuota: 1500, estado: "inscripcion", inscripciones: [], partidos: [], campeona: null,
  });
  assert.deepEqual(await verTorneo(api, t.id), t);
  const inscripciones = await inscribirParejas(api, t.id, 2);
  assert.deepEqual((await verTorneo(api, t.id)).inscripciones, inscripciones);
  const cerrado = await cerrar(api, t.id);
  const consultado = await verTorneo(api, t.id);
  assert.deepEqual(consultado, cerrado);
  assert.equal(consultado.partidos.length, 1);
  for (const [metodo, ruta] of [
    ["GET", "/api/torneos/T-9999"],
    ["POST", "/api/torneos/T-9999/inscripciones"],
    ["POST", `/api/torneos/T-9999/inscripciones/${inscripciones[0].id}/baja`],
    ["POST", "/api/torneos/T-9999/cerrar"],
    ["POST", `/api/torneos/T-9999/partidos/${consultado.partidos[0].id}/resultado`],
    ["POST", "/api/torneos/T-9999/cancelar"],
  ] as const) {
    const cuerpo = ruta.endsWith("inscripciones") ? { socios: ["socio-020", "socio-021"] } : ruta.endsWith("resultado") ? { ganadora: inscripciones[0].id } : undefined;
    esError(await api.pedir(metodo, ruta, { socio: GESTOR, cuerpo }), 404, "TORNEO_NO_ENCONTRADO");
  }
}));

test("listado: todos los torneos por orden de su primera franja, con sus inscritas, y el filtro por estado", () => conApi(async (api) => {
  const domingo = await crearTorneo(api, { nombre: "Domingo", franjas: ["2026-11-29T09:00", "2026-11-29T10:30"] });
  const mediodia = await crearTorneo(api, { nombre: "Mediodía", pistas: ["pista-3"], franjas: ["2026-11-28T13:30", "2026-11-28T12:00"], plazas: 4, cuota: 0 });
  const manana = await crearTorneo(api, { nombre: "Mañana", pistas: ["pista-1"], franjas: ["2026-11-28T09:00"], plazas: 4, cuota: 1000 });
  assert.equal((await pedirCancelacion(api, mediodia.id)).status, 200);
  const [primera] = await inscribirParejas(api, manana.id, 3);
  assert.equal((await pedirBaja(api, manana.id, primera.id)).status, 200);
  await inscribirParejas(api, domingo.id, 2, 10);
  await cerrar(api, domingo.id);
  const r = await api.pedir("GET", "/api/torneos");
  assert.equal(r.status, 200, r.texto);
  assert.deepEqual(r.cuerpo.torneos, [
    { id: manana.id, nombre: "Mañana", estado: "inscripcion", plazas: 4, cuota: 1000, inscritas: 2 },
    { id: mediodia.id, nombre: "Mediodía", estado: "cancelado", plazas: 4, cuota: 0, inscritas: 0 },
    { id: domingo.id, nombre: "Domingo", estado: "en_juego", plazas: 8, cuota: 2000, inscritas: 2 },
  ]);
  const ids = async (estado: string) => (await api.pedir("GET", `/api/torneos?estado=${estado}`)).cuerpo.torneos.map((t: any) => t.id);
  assert.deepEqual(await ids("cancelado"), [mediodia.id]);
  assert.deepEqual(await ids("inscripcion"), [manana.id]);
  assert.deepEqual(await ids("en_juego"), [domingo.id]);
  assert.deepEqual(await ids("terminado"), []);
  esError(await api.pedir("GET", "/api/torneos?estado=abierto"), 400, "DATOS_INVALIDOS");
}));

test("franjas bloqueadas: salen como torneo en la disponibilidad y no se pueden reservar", () => conApi(async (api) => {
  const t = await crearTorneo(api);
  const d = await api.pedir("GET", "/api/disponibilidad?fecha=2026-11-28");
  for (const p of d.cuerpo.pistas) {
    for (const f of p.franjas) {
      if (DATOS.pistas.includes(p.pistaId) && SABADO.includes(f.inicio)) {
        assert.deepEqual([f.estado, f.torneoId], ["torneo", t.id], `${p.pistaId} ${f.inicio}`);
      } else {
        assert.equal(f.estado, p.pistaId === "pista-4" ? "cerrada" : "libre", `${p.pistaId} ${f.inicio}`);
        assert.equal("torneoId" in f, false, `${p.pistaId} ${f.inicio}`);
      }
    }
  }
  assert.deepEqual(await franja(api, "pista-2", "2026-11-28T13:30"), { inicio: "2026-11-28T13:30", fin: "2026-11-28T15:00", estado: "torneo", torneoId: t.id, precio: 2800 });
  for (const pistaId of DATOS.pistas) {
    for (const inicio of SABADO) esError(await reservar(api, "socio-003", pistaId, inicio), 409, "FRANJA_NO_DISPONIBLE");
  }
  assert.equal((await reservar(api, "socio-003", "pista-3", "2026-11-28T09:00")).status, 201);
  assert.equal((await reservar(api, "socio-003", "pista-1", "2026-11-28T15:00")).status, 201);
}));

test("inscribirse: dos socios distintos, 201 con la cuota del torneo como importe y al final de las inscripciones", () => conApi(async (api) => {
  const t = await crearTorneo(api, { cuota: 1750 });
  for (const socios of [undefined, "socio-001", [], ["socio-001"], ["socio-001", "socio-001"], ["socio-001", "socio-002", "socio-003"], ["socio-001", 2]]) {
    esError(await pedirInscripcion(api, t.id, socios), 400, "DATOS_INVALIDOS");
  }
  assert.deepEqual((await verTorneo(api, t.id)).inscripciones, []);
  const r = await pedirInscripcion(api, t.id, ["socio-002", "socio-001"], "socio-001");
  assert.equal(r.status, 201, r.texto);
  const primera = r.cuerpo.inscripcion;
  assert.equal(typeof primera.id, "string");
  assert.deepEqual(primera, { id: primera.id, socios: ["socio-002", "socio-001"], estado: "inscrita", importe: 1750 });
  const segunda = await inscribir(api, t.id, ["socio-003", "socio-004"]);
  assert.notEqual(segunda.id, primera.id);
  assert.deepEqual((await verTorneo(api, t.id)).inscripciones, [primera, segunda]);
}));

test("quién puede jugar: los dos socios existen, tienen la cuota al día y no están ya inscritos en ese torneo", () => conApi(async (api) => {
  const t = await crearTorneo(api);
  esError(await pedirInscripcion(api, t.id, ["socio-001", "socio-999"]), 404, "SOCIO_NO_ENCONTRADO");
  esError(await pedirInscripcion(api, t.id, ["socio-011", "socio-001"]), 409, "CUOTA_INACTIVA");
  esError(await pedirInscripcion(api, t.id, ["socio-001", "socio-022"]), 409, "CUOTA_INACTIVA");
  await inscribir(api, t.id, ["socio-001", "socio-002"]);
  esError(await pedirInscripcion(api, t.id, ["socio-003", "socio-001"]), 409, "YA_INSCRITO");
  esError(await pedirInscripcion(api, t.id, ["socio-002", "socio-003"]), 409, "YA_INSCRITO");
  assert.equal((await verTorneo(api, t.id)).inscripciones.length, 1);
  const otro = await crearTorneo(api, { pistas: ["pista-3"] });
  await inscribir(api, otro.id, ["socio-001", "socio-002"]);
}));

test("plazas: con tantas inscritas como plazas, TORNEO_COMPLETO, y las bajas dejan su plaza libre", () => conApi(async (api) => {
  const t = await crearTorneo(api, { plazas: 4 });
  const inscripciones = await inscribirParejas(api, t.id, 4);
  esError(await pedirInscripcion(api, t.id, ["socio-020", "socio-021"]), 409, "TORNEO_COMPLETO");
  assert.equal((await pedirBaja(api, t.id, inscripciones[1].id)).status, 200);
  await inscribir(api, t.id, ["socio-020", "socio-021"]);
  esError(await pedirInscripcion(api, t.id, ["socio-023", "socio-024"]), 409, "TORNEO_COMPLETO");
  assert.equal((await api.pedir("GET", "/api/torneos")).cuerpo.torneos[0].inscritas, 4);
}));

test("plazo de inscripción: hasta 48 horas antes de la primera franja y solo con el torneo en inscripción", () => conApi(async (api) => {
  // Las franjas llegan desordenadas: la primera es la del sábado 28 a las 09:00, así que el plazo acaba el jueves 26 a las 09:00.
  const t = await crearTorneo(api, { franjas: ["2026-11-28T12:00", "2026-11-28T09:00"] });
  const [a] = await inscribirParejas(api, t.id, 2);
  await reloj(api, "2026-11-26T09:00");
  const b = await inscribir(api, t.id, ["socio-020", "socio-021"]);
  assert.equal((await pedirBaja(api, t.id, b.id)).status, 200);
  await reloj(api, "2026-11-26T09:01");
  esError(await pedirInscripcion(api, t.id, ["socio-023", "socio-024"]), 409, "INSCRIPCION_CERRADA");
  esError(await pedirBaja(api, t.id, a.id), 409, "INSCRIPCION_CERRADA");
  // En juego tampoco, aunque falte mucho.
  await reloj(api, "2026-11-20T10:00");
  await cerrar(api, t.id);
  esError(await pedirInscripcion(api, t.id, ["socio-023", "socio-024"]), 409, "INSCRIPCION_CERRADA");
  esError(await pedirBaja(api, t.id, a.id), 409, "INSCRIPCION_CERRADA");
  // Ni cancelado.
  const otro = await crearTorneo(api, { pistas: ["pista-3"] });
  const c = await inscribir(api, otro.id, ["socio-023", "socio-024"]);
  assert.equal((await pedirCancelacion(api, otro.id)).status, 200);
  esError(await pedirInscripcion(api, otro.id, ["socio-025", "socio-026"]), 409, "INSCRIPCION_CERRADA");
  esError(await pedirBaja(api, otro.id, c.id), 409, "INSCRIPCION_CERRADA");
}));

test("plazo de inscripción: las 48 horas son reales, con el cambio de hora de marzo", () => conApi(async (api) => {
  // El domingo 28 de marzo de 2027 los relojes se adelantan: del sábado 27 a las 08:00 al lunes 29 a las 09:00 hay 48 horas reales.
  await reloj(api, "2027-03-20T10:00");
  const t = await crearTorneo(api, { franjas: ["2027-03-29T09:00"] });
  await reloj(api, "2027-03-27T08:00");
  await inscribir(api, t.id, ["socio-001", "socio-002"]);
  await reloj(api, "2027-03-27T08:01");
  esError(await pedirInscripcion(api, t.id, ["socio-003", "socio-004"]), 409, "INSCRIPCION_CERRADA");
}));

test("baja: la inscripción sigue en el torneo como baja y sus socios se pueden volver a inscribir", () => conApi(async (api) => {
  const t = await crearTorneo(api);
  const a = await inscribir(api, t.id, ["socio-001", "socio-002"]);
  const b = await inscribir(api, t.id, ["socio-003", "socio-004"]);
  const r = await pedirBaja(api, t.id, a.id, "socio-002");
  assert.equal(r.status, 200, r.texto);
  assert.deepEqual(r.cuerpo.inscripcion, { ...a, estado: "baja" });
  esError(await pedirBaja(api, t.id, a.id), 409, "YA_DE_BAJA");
  const otra = await inscribir(api, t.id, ["socio-002", "socio-001"]);
  assert.notEqual(otra.id, a.id);
  assert.deepEqual((await verTorneo(api, t.id)).inscripciones, [{ ...a, estado: "baja" }, b, otra]);
  esError(await pedirBaja(api, t.id, "I-9999"), 404, "INSCRIPCION_NO_ENCONTRADA");
  const otro = await crearTorneo(api, { pistas: ["pista-3"] });
  const ajena = await inscribir(api, otro.id, ["socio-005", "socio-006"]);
  esError(await pedirBaja(api, t.id, ajena.id), 404, "INSCRIPCION_NO_ENCONTRADA");
  assert.equal((await verTorneo(api, otro.id)).inscripciones[0].estado, "inscrita");
}));

test("cerrar: solo en inscripción y con 2 parejas inscritas o más, también antes de que acabe el plazo", () => conApi(async (api) => {
  const t = await crearTorneo(api);
  esError(await pedirCierre(api, t.id), 409, "PAREJAS_INSUFICIENTES");
  const [a] = await inscribirParejas(api, t.id, 2);
  assert.equal((await pedirBaja(api, t.id, a.id)).status, 200);
  esError(await pedirCierre(api, t.id), 409, "PAREJAS_INSUFICIENTES");
  assert.deepEqual([(await verTorneo(api, t.id)).estado, (await verTorneo(api, t.id)).partidos], ["inscripcion", []]);
  await inscribir(api, t.id, ["socio-020", "socio-021"]);
  // Hoy es miércoles 18: el plazo de inscripción sigue abierto hasta el jueves 26.
  const r = await pedirCierre(api, t.id);
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.cuerpo.torneo.estado, "en_juego");
  assert.equal(r.cuerpo.torneo.partidos.length, 1);
  assert.deepEqual(await verTorneo(api, t.id), r.cuerpo.torneo);
  esError(await pedirCierre(api, t.id), 409, "TORNEO_NO_EN_INSCRIPCION");
  const cancelado = await crearTorneo(api, { pistas: ["pista-3"] });
  await inscribirParejas(api, cancelado.id, 2, 20);
  assert.equal((await pedirCancelacion(api, cancelado.id)).status, 200);
  esError(await pedirCierre(api, cancelado.id), 409, "TORNEO_NO_EN_INSCRIPCION");
}));

test("cuadro: con 2 parejas, un solo partido, que es la final", () => conApi(async (api) => {
  const { torneo, inscripciones } = await torneoEnJuego(api, 2);
  assert.deepEqual(cuadro(torneo), [[1, 1, 1, 2, "pendiente", null, "pista-1", "2026-11-28T09:00"]]);
  const [final] = torneo.partidos;
  assert.equal(typeof final.id, "string");
  assert.deepEqual(final, {
    id: final.id, ronda: 1, numero: 1, parejas: [inscripciones[0].id, inscripciones[1].id], estado: "pendiente",
    ganadora: null, marcador: null, pistaId: "pista-1", inicio: "2026-11-28T09:00",
  });
}));

test("cuadro: con 3 parejas, la 1 descansa y espera en la final a la ganadora de 2 contra 3", () => conApi(async (api) => {
  const { torneo, inscripciones } = await torneoEnJuego(api, 3);
  assert.deepEqual(cuadro(torneo), [
    [1, 1, 1, null, "descanso", 1, null, null],
    [1, 2, 2, 3, "pendiente", null, "pista-1", "2026-11-28T09:00"],
    [2, 1, 1, null, "pendiente", null, "pista-1", "2026-11-28T10:30"],
  ]);
  const [descanso] = torneo.partidos;
  assert.deepEqual(descanso, {
    id: descanso.id, ronda: 1, numero: 1, parejas: [inscripciones[0].id, null], estado: "descanso",
    ganadora: inscripciones[0].id, marcador: null, pistaId: null, inicio: null,
  });
}));

test("cuadro: con 5 parejas, el ejemplo de la spec", () => conApi(async (api) => {
  const { torneo } = await torneoEnJuego(api, 5);
  assert.deepEqual(cuadro(torneo), [
    [1, 1, 1, null, "descanso", 1, null, null],
    [1, 2, 2, null, "descanso", 2, null, null],
    [1, 3, 3, null, "descanso", 3, null, null],
    [1, 4, 4, 5, "pendiente", null, "pista-1", "2026-11-28T09:00"],
    [2, 1, 1, null, "pendiente", null, "pista-1", "2026-11-28T10:30"],
    // Sus dos parejas vienen de descansos, que no cuentan: puede jugarse en la primera franja.
    [2, 2, 2, 3, "pendiente", null, "pista-2", "2026-11-28T09:00"],
    [3, 1, null, null, "pendiente", null, "pista-1", "2026-11-28T12:00"],
  ]);
}));

test("cuadro: con 6 y con 8 parejas", () => conApi(async (api) => {
  const seis = await torneoEnJuego(api, 6);
  assert.deepEqual(cuadro(seis.torneo), [
    [1, 1, 1, null, "descanso", 1, null, null],
    [1, 2, 2, null, "descanso", 2, null, null],
    [1, 3, 3, 6, "pendiente", null, "pista-1", "2026-11-28T09:00"],
    [1, 4, 4, 5, "pendiente", null, "pista-2", "2026-11-28T09:00"],
    [2, 1, 1, null, "pendiente", null, "pista-1", "2026-11-28T10:30"],
    [2, 2, 2, null, "pendiente", null, "pista-2", "2026-11-28T10:30"],
    [3, 1, null, null, "pendiente", null, "pista-1", "2026-11-28T12:00"],
  ]);
  const ocho = await torneoEnJuego(api, 8, { franjas: SABADO.map((f) => f.replace("-28T", "-29T")) });
  assert.deepEqual(cuadro(ocho.torneo), [
    [1, 1, 1, 8, "pendiente", null, "pista-1", "2026-11-29T09:00"],
    [1, 2, 2, 7, "pendiente", null, "pista-2", "2026-11-29T09:00"],
    [1, 3, 3, 6, "pendiente", null, "pista-1", "2026-11-29T10:30"],
    [1, 4, 4, 5, "pendiente", null, "pista-2", "2026-11-29T10:30"],
    [2, 1, null, null, "pendiente", null, "pista-1", "2026-11-29T12:00"],
    [2, 2, null, null, "pendiente", null, "pista-2", "2026-11-29T12:00"],
    [3, 1, null, null, "pendiente", null, "pista-1", "2026-11-29T13:30"],
  ]);
}));

test("cuadro: las parejas se numeran por orden de inscripción, sin contar las bajas", () => conApi(async (api) => {
  const t = await crearTorneo(api);
  const [a, b, c, d] = await inscribirParejas(api, t.id, 4);
  assert.equal((await pedirBaja(api, t.id, b.id)).status, 200);
  const otra = await inscribir(api, t.id, b.socios);
  const cerrado = await cerrar(api, t.id);
  assert.deepEqual(cerrado.partidos.map((p: any) => [p.ronda, p.numero, p.parejas]), [
    [1, 1, [a.id, otra.id]],
    [1, 2, [c.id, d.id]],
    [2, 1, [null, null]],
  ]);
}));

test("calendario: con 16 parejas en tres pistas, a cada partido le toca la primera combinación libre después de los suyos", () => conApi(async (api) => {
  const franjas = ["09:00", "10:30", "12:00", "13:30", "15:00", "16:30", "18:00", "19:30", "21:00"].map((h) => `2026-11-28T${h}`);
  const { torneo } = await torneoEnJuego(api, 16, { pistas: ["pista-1", "pista-2", "pista-3"], franjas, plazas: 16 });
  assert.deepEqual(cuadro(torneo).map((p: any[]) => [p[0], p[1], p[2], p[3], p[6], p[7].slice(11)]), [
    [1, 1, 1, 16, "pista-1", "09:00"], [1, 2, 2, 15, "pista-2", "09:00"], [1, 3, 3, 14, "pista-3", "09:00"],
    [1, 4, 4, 13, "pista-1", "10:30"], [1, 5, 5, 12, "pista-2", "10:30"], [1, 6, 6, 11, "pista-3", "10:30"],
    [1, 7, 7, 10, "pista-1", "12:00"], [1, 8, 8, 9, "pista-2", "12:00"],
    // El 1 espera a los partidos 1 y 8 (acaba a las 13:30); el 3, a los partidos 3 y 6, que acaban a las 12:00.
    [2, 1, null, null, "pista-1", "13:30"], [2, 2, null, null, "pista-2", "13:30"],
    [2, 3, null, null, "pista-3", "12:00"], [2, 4, null, null, "pista-3", "13:30"],
    [3, 1, null, null, "pista-1", "15:00"], [3, 2, null, null, "pista-2", "15:00"],
    [4, 1, null, null, "pista-1", "16:30"],
  ]);
}));

test("calendario: franjas no seguidas y sin las franjas que ya han empezado", () => conApi(async (api) => {
  // Una sola pista, el sábado a las 09:00 y el domingo a las 18:00: la final espera al domingo.
  const sueltas = await torneoEnJuego(api, 3, { pistas: ["pista-3"], franjas: ["2026-11-29T18:00", "2026-11-28T09:00"] });
  assert.deepEqual(cuadro(sueltas.torneo), [
    [1, 1, 1, null, "descanso", 1, null, null],
    [1, 2, 2, 3, "pendiente", null, "pista-3", "2026-11-28T09:00"],
    [2, 1, 1, null, "pendiente", null, "pista-3", "2026-11-29T18:00"],
  ]);
  // Si se cierra el sábado a las 09:00, esa franja ya ha empezado y no se usa.
  const t = await crearTorneo(api);
  await inscribirParejas(api, t.id, 4, 10);
  await reloj(api, "2026-11-28T09:00");
  assert.deepEqual(cuadro(await cerrar(api, t.id)), [
    [1, 1, 1, 4, "pendiente", null, "pista-1", "2026-11-28T10:30"],
    [1, 2, 2, 3, "pendiente", null, "pista-2", "2026-11-28T10:30"],
    [2, 1, null, null, "pendiente", null, "pista-1", "2026-11-28T12:00"],
  ]);
}));

test("franjas insuficientes: cerrar responde FRANJAS_INSUFICIENTES y el torneo se queda en inscripción", () => conApi(async (api) => {
  // 5 parejas son 4 partidos, y una pista con 3 franjas no llega.
  const t = await crearTorneo(api, { pistas: ["pista-3"], franjas: SABADO.slice(0, 3) });
  const inscripciones = await inscribirParejas(api, t.id, 5);
  const antes = await verTorneo(api, t.id);
  esError(await pedirCierre(api, t.id), 409, "FRANJAS_INSUFICIENTES");
  assert.deepEqual(await verTorneo(api, t.id), antes);
  assert.deepEqual([antes.estado, antes.partidos], ["inscripcion", []]);
  assert.equal((await franja(api, "pista-3", "2026-11-28T12:00")).estado, "torneo");
  // Con una baja son 3 partidos y ya caben.
  assert.equal((await pedirBaja(api, t.id, inscripciones[4].id)).status, 200);
  assert.equal((await cerrar(api, t.id)).estado, "en_juego");
  // Tres pistas en una sola franja dan 3 combinaciones para 3 partidos, pero la final tiene que ir después de las semifinales.
  const otro = await crearTorneo(api, { pistas: ["pista-1", "pista-2", "pista-3"], franjas: ["2026-11-29T09:00"] });
  await inscribirParejas(api, otro.id, 4, 10);
  esError(await pedirCierre(api, otro.id), 409, "FRANJAS_INSUFICIENTES");
  // Y si todas sus franjas ya han empezado, tampoco.
  const tarde = await crearTorneo(api, { nombre: "Tarde", pistas: ["pista-1"], franjas: ["2026-11-29T10:30"] });
  await inscribirParejas(api, tarde.id, 2, 20);
  await reloj(api, "2026-11-29T10:30");
  esError(await pedirCierre(api, tarde.id), 409, "FRANJAS_INSUFICIENTES");
  assert.equal((await verTorneo(api, tarde.id)).estado, "inscripcion");
}));

test("franjas sobrantes: al cerrar, las combinaciones sin partido dejan de estar bloqueadas y se pueden reservar", () => conApi(async (api) => {
  const { torneo } = await torneoEnJuego(api, 3);
  const usadas = torneo.partidos.filter((p: any) => p.estado !== "descanso").map((p: any) => `${p.pistaId} ${p.inicio}`);
  assert.deepEqual(usadas, ["pista-1 2026-11-28T09:00", "pista-1 2026-11-28T10:30"]);
  for (const pistaId of DATOS.pistas) {
    for (const inicio of SABADO) {
      const f = await franja(api, pistaId, inicio);
      if (usadas.includes(`${pistaId} ${inicio}`)) {
        assert.deepEqual([f.estado, f.torneoId], ["torneo", torneo.id]);
        esError(await reservar(api, "socio-030", pistaId, inicio), 409, "FRANJA_NO_DISPONIBLE");
      } else {
        assert.equal(f.estado, "libre");
        assert.equal("torneoId" in f, false);
      }
    }
  }
  assert.equal((await reservar(api, "socio-030", "pista-2", "2026-11-28T09:00")).status, 201);
  assert.equal((await reservar(api, "socio-030", "pista-1", "2026-11-28T12:00")).status, 201);
  assert.equal((await reservar(api, "socio-031", "pista-2", "2026-11-28T13:30")).status, 201);
}));

test("apuntar un resultado: ganadora de ese partido, con el torneo en juego, el partido listo y ya empezado", () => conApi(async (api) => {
  const { torneo, inscripciones } = await torneoEnJuego(api, 5);
  const [descanso, , , cuartos, semi1, semi2, final] = torneo.partidos;
  const [i1, , , i4, i5] = inscripciones;
  const otro = await torneoEnJuego(api, 2, { pistas: ["pista-3"], franjas: ["2026-11-29T09:00"] });
  // El partido 4 contra 5 es el sábado a las 09:00.
  await reloj(api, "2026-11-28T08:59");
  esError(await apuntar(api, torneo.id, cuartos.id, { ganadora: i4.id }), 409, "PARTIDO_NO_EMPEZADO");
  await reloj(api, "2026-11-28T09:00");
  esError(await apuntar(api, torneo.id, descanso.id, { ganadora: i1.id }), 409, "PARTIDO_NO_LISTO");
  esError(await apuntar(api, torneo.id, semi1.id, { ganadora: i1.id }), 409, "PARTIDO_NO_LISTO");
  esError(await apuntar(api, torneo.id, final.id, { ganadora: i1.id }), 409, "PARTIDO_NO_LISTO");
  for (const cuerpo of [{ ganadora: i1.id }, {}, { ganadora: "I-9999" }, { ganadora: i4.id, marcador: 64 }]) {
    esError(await apuntar(api, torneo.id, cuartos.id, cuerpo), 400, "DATOS_INVALIDOS");
  }
  esError(await apuntar(api, torneo.id, "P-9999", { ganadora: i4.id }), 404, "PARTIDO_NO_ENCONTRADO");
  esError(await apuntar(api, torneo.id, otro.torneo.partidos[0].id, { ganadora: i4.id }), 404, "PARTIDO_NO_ENCONTRADO");
  assert.equal((await verTorneo(api, torneo.id)).partidos[3].estado, "pendiente");
  const r = await apuntar(api, torneo.id, cuartos.id, { ganadora: i5.id, marcador: "6-4 6-3" });
  assert.equal(r.status, 200, r.texto);
  assert.deepEqual(r.cuerpo.partido, { ...cuartos, estado: "jugado", ganadora: i5.id, marcador: "6-4 6-3" });
  const sinMarcador = await apuntarBien(api, torneo.id, semi2.id, { ganadora: semi2.parejas[1] });
  assert.deepEqual([sinMarcador.estado, sinMarcador.ganadora, sinMarcador.marcador], ["jugado", semi2.parejas[1], null]);
  // Con el torneo en inscripción o cancelado, no.
  const enInscripcion = await crearTorneo(api, { pistas: ["pista-3"], franjas: ["2026-11-29T12:00"] });
  esError(await apuntar(api, enInscripcion.id, final.id, { ganadora: i1.id }), 409, "TORNEO_NO_EN_JUEGO");
  assert.equal((await pedirCancelacion(api, otro.torneo.id)).status, 200);
  await reloj(api, "2026-11-29T09:00");
  const [unico] = otro.torneo.partidos;
  esError(await apuntar(api, otro.torneo.id, unico.id, { ganadora: unico.parejas[0] }), 409, "TORNEO_NO_EN_JUEGO");
}));

test("la ganadora pasa de ronda: a su sitio en el partido siguiente, y las de los descansos, al cerrar", () => conApi(async (api) => {
  const { torneo, inscripciones } = await torneoEnJuego(api, 5);
  const [, , , cuartos, semi1, semi2, final] = torneo.partidos;
  const [i1, i2, i3, i4] = inscripciones;
  assert.deepEqual([semi1.parejas, semi2.parejas, final.parejas], [[i1.id, null], [i2.id, i3.id], [null, null]]);
  await reloj(api, "2026-11-28T09:00");
  await apuntarBien(api, torneo.id, cuartos.id, { ganadora: i4.id });
  await apuntarBien(api, torneo.id, semi2.id, { ganadora: i3.id });
  let ahora = await verTorneo(api, torneo.id);
  assert.deepEqual([ahora.partidos[4].parejas, ahora.partidos[6].parejas], [[i1.id, i4.id], [null, i3.id]]);
  esError(await apuntar(api, torneo.id, final.id, { ganadora: i3.id }), 409, "PARTIDO_NO_LISTO");
  await reloj(api, "2026-11-28T10:30");
  await apuntarBien(api, torneo.id, semi1.id, { ganadora: i4.id, marcador: "6-2 6-2" });
  ahora = await verTorneo(api, torneo.id);
  assert.deepEqual(ahora.partidos[6].parejas, [i4.id, i3.id]);
  // La final ya tiene sus dos parejas, pero no empieza hasta las 12:00.
  esError(await apuntar(api, torneo.id, final.id, { ganadora: i3.id }), 409, "PARTIDO_NO_EMPEZADO");
  assert.equal(ahora.estado, "en_juego");
}));

test("corregir un resultado: cambia también la pareja que pasó, mientras el partido siguiente no se haya jugado", () => conApi(async (api) => {
  const { torneo, inscripciones } = await torneoEnJuego(api, 5);
  const [, , , cuartos, semi1, semi2] = torneo.partidos;
  const [i1, i2, i3, i4, i5] = inscripciones;
  await reloj(api, "2026-11-28T10:30");
  await apuntarBien(api, torneo.id, cuartos.id, { ganadora: i4.id, marcador: "6-4 6-4" });
  const corregido = await apuntarBien(api, torneo.id, cuartos.id, { ganadora: i5.id, marcador: "4-6 4-6" });
  assert.deepEqual([corregido.estado, corregido.ganadora, corregido.marcador], ["jugado", i5.id, "4-6 4-6"]);
  assert.deepEqual((await verTorneo(api, torneo.id)).partidos[4].parejas, [i1.id, i5.id]);
  const sinMarcador = await apuntarBien(api, torneo.id, cuartos.id, { ganadora: i5.id });
  assert.equal(sinMarcador.marcador, null);
  await apuntarBien(api, torneo.id, semi1.id, { ganadora: i5.id });
  esError(await apuntar(api, torneo.id, cuartos.id, { ganadora: i4.id }), 409, "RESULTADO_CERRADO");
  const despues = await verTorneo(api, torneo.id);
  assert.deepEqual([despues.partidos[3].ganadora, despues.partidos[4].parejas], [i5.id, [i1.id, i5.id]]);
  // La semifinal se puede corregir mientras no se juegue la final.
  await apuntarBien(api, torneo.id, semi2.id, { ganadora: i2.id });
  await apuntarBien(api, torneo.id, semi1.id, { ganadora: i1.id });
  await apuntarBien(api, torneo.id, semi2.id, { ganadora: i3.id });
  assert.deepEqual((await verTorneo(api, torneo.id)).partidos[6].parejas, [i1.id, i3.id]);
}));

test("campeona: el resultado de la final termina el torneo, y con 2 parejas el único partido es la final", () => conApi(async (api) => {
  const { torneo, inscripciones } = await torneoEnJuego(api, 2);
  // Con 5 parejas, el domingo: la campeona sale de la tercera ronda.
  const cinco = await torneoEnJuego(api, 5, { franjas: SABADO.map((f) => f.replace("-28T", "-29T")) });
  const [final] = torneo.partidos;
  assert.equal(torneo.partidos.length, 1);
  await reloj(api, final.inicio);
  await apuntarBien(api, torneo.id, final.id, { ganadora: inscripciones[1].id, marcador: "7-6 6-7 10-8" });
  const terminado = await verTorneo(api, torneo.id);
  assert.deepEqual([terminado.estado, terminado.campeona], ["terminado", inscripciones[1].id]);
  assert.deepEqual((await api.pedir("GET", "/api/torneos?estado=terminado")).cuerpo.torneos.map((t: any) => t.id), [torneo.id]);
  esError(await apuntar(api, torneo.id, final.id, { ganadora: inscripciones[0].id }), 409, "TORNEO_NO_EN_JUEGO");
  const [, , , c45, s1, s2, f] = cinco.torneo.partidos;
  await reloj(api, "2026-11-29T12:00");
  await apuntarBien(api, cinco.torneo.id, c45.id, { ganadora: c45.parejas[0] });
  await apuntarBien(api, cinco.torneo.id, s1.id, { ganadora: s1.parejas[0] });
  await apuntarBien(api, cinco.torneo.id, s2.id, { ganadora: s2.parejas[1] });
  assert.equal((await verTorneo(api, cinco.torneo.id)).campeona, null);
  const laFinal = await apuntarBien(api, cinco.torneo.id, f.id, { ganadora: s2.parejas[1] });
  assert.deepEqual(laFinal.parejas, [s1.parejas[0], s2.parejas[1]]);
  const fin = await verTorneo(api, cinco.torneo.id);
  assert.deepEqual([fin.estado, fin.campeona], ["terminado", s2.parejas[1]]);
}));

test("cancelar: libera todas las franjas, también en juego, salvo si ya está terminado o cancelado", () => conApi(async (api) => {
  const enInscripcion = await crearTorneo(api);
  const r = await pedirCancelacion(api, enInscripcion.id);
  assert.equal(r.status, 200, r.texto);
  assert.deepEqual(r.cuerpo.torneo, { ...enInscripcion, estado: "cancelado" });
  for (const inicio of SABADO) assert.equal((await franja(api, "pista-2", inicio)).estado, "libre");
  esError(await pedirCancelacion(api, enInscripcion.id), 409, "YA_CANCELADO");
  const { torneo } = await torneoEnJuego(api, 4);
  const usadas = torneo.partidos.map((p: any) => [p.pistaId, p.inicio]);
  for (const [pistaId, inicio] of usadas) assert.equal((await franja(api, pistaId, inicio)).estado, "torneo");
  assert.equal((await pedirCancelacion(api, torneo.id)).cuerpo.torneo.estado, "cancelado");
  for (const [pistaId, inicio] of usadas) {
    assert.equal((await franja(api, pistaId, inicio)).estado, "libre");
    assert.equal((await reservar(api, "socio-034", pistaId, inicio)).status, 201);
  }
  const corto = await torneoEnJuego(api, 2, { pistas: ["pista-3"], franjas: ["2026-11-29T09:00"] });
  await reloj(api, "2026-11-29T09:00");
  await apuntarBien(api, corto.torneo.id, corto.torneo.partidos[0].id, { ganadora: corto.inscripciones[0].id });
  esError(await pedirCancelacion(api, corto.torneo.id), 409, "TORNEO_TERMINADO");
  assert.equal((await franja(api, "pista-3", "2026-11-29T09:00")).estado, "torneo");
}));

test("los partidos no son reservas: no salen en las reservas ni cuentan para el límite de 3", () => conApi(async (api) => {
  // socio-001 tiene una reserva futura en la semilla: con estas dos llega al límite de 3 y se inscribe igual.
  for (const inicio of ["2026-11-29T09:00", "2026-11-29T10:30"]) {
    assert.equal((await reservar(api, "socio-001", "pista-3", inicio)).status, 201);
  }
  esError(await reservar(api, "socio-001", "pista-3", "2026-11-29T12:00"), 409, "LIMITE_DE_RESERVAS");
  const antes = (await api.pedir("GET", "/api/reservas?limite=1")).cuerpo.total;
  const { torneo } = await torneoEnJuego(api, 4);
  assert.deepEqual(torneo.inscripciones.map((i: any) => i.socios), [["socio-001", "socio-002"], ["socio-003", "socio-004"], ["socio-005", "socio-006"], ["socio-007", "socio-008"]]);
  assert.equal((await api.pedir("GET", "/api/reservas?limite=1")).cuerpo.total, antes);
  assert.equal((await api.pedir("GET", "/api/reservas?fecha=2026-11-28")).cuerpo.total, 0);
  assert.equal((await api.pedir("GET", "/api/reservas?socio=socio-001&desde=2026-11-25")).cuerpo.total, 2);
  // socio-006 juega el torneo y no tiene reservas: el partido no cuenta y puede hacer 3.
  for (const inicio of ["2026-11-29T12:00", "2026-11-29T13:30", "2026-11-29T15:00"]) {
    assert.equal((await reservar(api, "socio-006", "pista-3", inicio)).status, 201);
  }
  esError(await reservar(api, "socio-006", "pista-3", "2026-11-29T16:30"), 409, "LIMITE_DE_RESERVAS");
}));

test("lo demás no cambia: la disponibilidad sin torneos y las reservas funcionan igual", () => conApi(async (api) => {
  const limpia = await arrancarApi();
  abiertas.add(limpia);
  try {
    await crearTorneo(api);
    for (const ruta of ["/api/disponibilidad?fecha=2026-11-19", "/api/disponibilidad?fecha=2026-11-29", "/api/disponibilidad?fecha=2026-11-28&pista=pista-3", "/api/reservas?desde=2026-11-18"]) {
      assert.deepEqual((await api.pedir("GET", ruta)).cuerpo, (await limpia.pedir("GET", ruta)).cuerpo, ruta);
    }
    const nueva = await reservar(api, "socio-003", "pista-3", "2026-11-28T09:00");
    assert.equal(nueva.status, 201, nueva.texto);
    assert.equal(nueva.cuerpo.reserva.importe, 2000);
    esError(await reservar(api, "socio-006", "pista-3", "2026-11-28T09:00"), 409, "FRANJA_NO_DISPONIBLE");
    assert.equal((await api.pedir("POST", `/api/reservas/${nueva.cuerpo.reserva.id}/cancelar`)).cuerpo.reserva.estado, "cancelada");
  } finally {
    limpia.cerrar();
    abiertas.delete(limpia);
  }
}));

test("el README documenta los torneos", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  for (const texto of [
    "/api/torneos", "/inscripciones/:inscripcionId/baja", "/cerrar", "/partidos/:partidoId/resultado", "/cancelar",
    "inscripcion", "en_juego", "terminado", "cancelado", "48 horas", "T+1−i", "M+1−j", "descanso", "torneoId", "conflictos",
    "SIN_PERMISO", "TORNEO_NO_ENCONTRADO", "FRANJAS_OCUPADAS", "INSCRIPCION_CERRADA", "YA_INSCRITO", "TORNEO_COMPLETO",
    "INSCRIPCION_NO_ENCONTRADA", "YA_DE_BAJA", "TORNEO_NO_EN_INSCRIPCION", "PAREJAS_INSUFICIENTES", "FRANJAS_INSUFICIENTES",
    "TORNEO_NO_EN_JUEGO", "PARTIDO_NO_ENCONTRADO", "PARTIDO_NO_LISTO", "PARTIDO_NO_EMPEZADO", "RESULTADO_CERRADO",
    "TORNEO_TERMINADO", "YA_CANCELADO",
  ]) {
    assert.ok(readme.includes(texto), texto);
  }
});
