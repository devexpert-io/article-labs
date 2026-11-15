// Los partidos abiertos (docs/specs/partidos-abiertos.md), probados a través de la API: un test o más por criterio.
// Cada prueba arranca su propia API con el reloj en enero de 2027: nadie tiene reservas futuras y todas las franjas están libres.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { importePorJugador } from "../src/nucleo.ts";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

const GESTOR = "socio-040";
/** Lunes 4 de enero de 2027 a las 10:00. */
const ENERO = "2027-01-04T10:00";
/** Martes 5 de enero de 2027 a las 10:30, en horas valle: faltan 24 horas y media. */
const MARTES = "2027-01-05T10:30";

const abiertas = new Set<Api>();
after(() => abiertas.forEach((api) => api.cerrar()));

async function conApi(prueba: (api: Api) => Promise<void>) {
  const api = await arrancarApi({ AHORA: ENERO });
  abiertas.add(api);
  try {
    await prueba(api);
  } finally {
    api.cerrar();
    abiertas.delete(api);
  }
}

function esError(r: Respuesta, http: number, codigo: string, caso = "") {
  assert.equal(r.status, http, `${caso} ${r.texto}`);
  assert.equal(r.cuerpo.error.codigo, codigo, `${caso} ${r.texto}`);
}

/** Pide crear un partido como `socio` (null: sin cabecera X-Socio). */
const pedirPartido = (api: Api, socio: string | null, cuerpo: Record<string, unknown>) =>
  api.pedir("POST", "/api/partidos", { cuerpo, socio: socio ?? undefined });

async function crearPartido(api: Api, socio: string, cuerpo: Record<string, unknown>) {
  const r = await pedirPartido(api, socio, cuerpo);
  assert.equal(r.status, 201, r.texto);
  return r.cuerpo.partido;
}

/** POST /api/partidos/:id/<accion> como `socio` (null: sin cabecera X-Socio). */
const accion = (api: Api, id: string, nombre: "unirse" | "salir" | "cancelar", socio: string | null, cuerpo?: Record<string, unknown>) =>
  api.pedir("POST", `/api/partidos/${id}/${nombre}`, { socio: socio ?? undefined, cuerpo });

/** Une a los socios al partido, uno detrás de otro, y devuelve cómo queda. */
async function unirse(api: Api, id: string, ...socios: string[]) {
  let respuesta: Respuesta | undefined;
  for (const socio of socios) {
    respuesta = await accion(api, id, "unirse", socio);
    assert.equal(respuesta.status, 200, `${socio}: ${respuesta.texto}`);
  }
  return respuesta!.cuerpo.partido;
}

async function salir(api: Api, id: string, socio: string, cuerpo?: Record<string, unknown>) {
  const r = await accion(api, id, "salir", socio, cuerpo);
  assert.equal(r.status, 200, r.texto);
  return r.cuerpo.partido;
}

async function cancelar(api: Api, id: string, socio: string, cuerpo?: Record<string, unknown>) {
  const r = await accion(api, id, "cancelar", socio, cuerpo);
  assert.equal(r.status, 200, r.texto);
  return r.cuerpo.partido;
}

/** PATCH /api/socios/:id como `quien` (el propio socio si no se dice; null, sin cabecera X-Socio). */
const pedirNivel = (api: Api, socioId: string, cuerpo: Record<string, unknown> | undefined, quien: string | null = socioId) =>
  api.pedir("PATCH", `/api/socios/${socioId}`, { cuerpo, socio: quien ?? undefined });

async function fijarNivel(api: Api, socioId: string, nivel: number | null) {
  const r = await pedirNivel(api, socioId, { nivel });
  assert.equal(r.status, 200, r.texto);
  return r.cuerpo.socio;
}

/** El socio tal como sale en GET /api/socios. */
async function socio(api: Api, socioId: string) {
  return (await api.pedir("GET", `/api/socios?texto=${socioId}`)).cuerpo.socios.find((s: any) => s.id === socioId);
}

async function reloj(api: Api, ahora: string) {
  assert.equal((await api.pedir("POST", "/_reloj", { cuerpo: { ahora } })).status, 200);
}

const pedirReserva = (api: Api, socioId: string, pistaId: string, inicio: string) =>
  api.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio } });

async function reservar(api: Api, socioId: string, pistaId: string, inicio: string) {
  const r = await pedirReserva(api, socioId, pistaId, inicio);
  assert.equal(r.status, 201, r.texto);
  return r.cuerpo.reserva;
}

const leerPartido = async (api: Api, id: string) => (await api.pedir("GET", `/api/partidos/${id}`)).cuerpo.partido;
const leerReserva = async (api: Api, id: string) => (await api.pedir("GET", `/api/reservas/${id}`)).cuerpo.reserva;

/** Las reservas de un socio desde 2027. */
async function reservasDe(api: Api, socioId: string) {
  return (await api.pedir("GET", `/api/reservas?socio=${socioId}&desde=2027-01-01&limite=100`)).cuerpo.reservas;
}

/** El estado de una franja en la disponibilidad. */
async function franja(api: Api, pistaId: string, inicio: string) {
  const r = await api.pedir("GET", `/api/disponibilidad?fecha=${inicio.slice(0, 10)}&pista=${pistaId}`);
  return r.cuerpo.pistas[0].franjas.find((f: any) => f.inicio === inicio).estado;
}

/** Los ids de GET /api/partidos con la consulta `consulta`. */
async function listar(api: Api, consulta = "") {
  const r = await api.pedir("GET", `/api/partidos${consulta}`);
  assert.equal(r.status, 200, `${consulta} ${r.texto}`);
  return r.cuerpo.partidos.map((p: any) => p.id);
}

test("C1 · crear, unirse, salir, cancelar y fijar el nivel piden X-Socio (401); consultar, no", () => conApi(async (api) => {
  esError(await pedirPartido(api, null, { pistaId: "pista-1", inicio: MARTES }), 401, "NO_IDENTIFICADO");
  assert.deepEqual(await reservasDe(api, "socio-003"), []);
  const p = await crearPartido(api, "socio-003", { pistaId: "pista-1", inicio: MARTES });
  await unirse(api, p.id, "socio-006");
  for (const nombre of ["unirse", "salir", "cancelar"] as const) {
    esError(await accion(api, p.id, nombre, null, { forzar: true }), 401, "NO_IDENTIFICADO", nombre);
  }
  esError(await pedirNivel(api, "socio-003", { nivel: 3 }, null), 401, "NO_IDENTIFICADO");
  assert.equal((await socio(api, "socio-003")).nivel, null);
  const lista = await api.pedir("GET", "/api/partidos");
  assert.equal(lista.status, 200, lista.texto);
  const uno = await api.pedir("GET", `/api/partidos/${p.id}`);
  assert.equal(uno.status, 200, uno.texto);
  assert.deepEqual(uno.cuerpo.partido.jugadores, ["socio-003", "socio-006"]);
  assert.equal(uno.cuerpo.partido.estado, "abierto");
}));

test("C1 · cancela el partido quien lo organiza o un gestor, y fija el nivel el propio socio o un gestor (si no, 403)", () => conApi(async (api) => {
  const a = await crearPartido(api, "socio-003", { pistaId: "pista-1", inicio: MARTES });
  const b = await crearPartido(api, "socio-007", { pistaId: "pista-2", inicio: MARTES });
  await unirse(api, a.id, "socio-006");
  esError(await accion(api, a.id, "cancelar", "socio-006"), 403, "SIN_PERMISO", "juega, pero no lo organiza");
  esError(await accion(api, a.id, "cancelar", "socio-007"), 403, "SIN_PERMISO", "organiza otro partido");
  assert.equal((await leerPartido(api, a.id)).estado, "abierto");
  assert.equal((await cancelar(api, a.id, "socio-003")).estado, "cancelado");
  assert.equal((await cancelar(api, b.id, GESTOR)).estado, "cancelado");

  esError(await pedirNivel(api, "socio-006", { nivel: 3 }, "socio-003"), 403, "SIN_PERMISO");
  assert.equal((await socio(api, "socio-006")).nivel, null);
  assert.equal((await pedirNivel(api, "socio-006", { nivel: 3 })).cuerpo.socio.nivel, 3);
  assert.equal((await pedirNivel(api, "socio-006", { nivel: 4.5 }, GESTOR)).cuerpo.socio.nivel, 4.5);
  assert.equal((await socio(api, "socio-006")).nivel, 4.5);
}));

test("C2 · PATCH /api/socios/:id fija el nivel (de 1 a 7 en pasos de 0,5) o lo quita con null, y GET /api/socios lo trae", () => conApi(async (api) => {
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  assert.ok(estado.socios.every((s: any) => s.nivel === null), "en la semilla, todos empiezan con null");
  const irene = await socio(api, "socio-004");
  assert.deepEqual(irene, { id: "socio-004", nombre: "Irene Sanz", email: "irene.sanz@example.com", cuotaActiva: true, rol: "socio", nivel: null });
  for (const nivel of [1, 1.5, 4.5, 7, 3]) {
    const r = await pedirNivel(api, "socio-004", { nivel });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.cuerpo.socio, { ...irene, nivel });
  }
  assert.equal((await socio(api, "socio-004")).nivel, 3);
  for (const nivel of [0, 0.5, 7.5, 8, -1, 3.25, 4.1, "4", "4.5", true, [], {}, undefined]) {
    esError(await pedirNivel(api, "socio-004", { nivel }), 400, "DATOS_INVALIDOS", JSON.stringify({ nivel }));
  }
  esError(await pedirNivel(api, "socio-004", undefined), 400, "DATOS_INVALIDOS", "sin cuerpo");
  assert.equal((await socio(api, "socio-004")).nivel, 3);
  const quitado = await pedirNivel(api, "socio-004", { nivel: null });
  assert.equal(quitado.status, 200, quitado.texto);
  assert.deepEqual(quitado.cuerpo.socio, irene);
  assert.equal((await socio(api, "socio-004")).nivel, null);
  esError(await pedirNivel(api, "socio-999", { nivel: 3 }, GESTOR), 404, "SOCIO_NO_ENCONTRADO");
}));

test("C3 · crear un partido reserva la pista con las mismas comprobaciones y los mismos errores que POST /api/reservas", () => conApi(async (api) => {
  for (const dia of ["05", "06", "07"]) await reservar(api, "socio-007", "pista-3", `2027-01-${dia}T12:00`);
  await reservar(api, "socio-008", "pista-2", "2027-01-05T19:30");
  const casos: [string, Record<string, unknown>, number, string][] = [
    ["socio-003", { inicio: MARTES }, 400, "DATOS_INVALIDOS"],
    ["socio-003", { pistaId: "pista-1" }, 400, "DATOS_INVALIDOS"],
    ["socio-003", { pistaId: "pista-9", inicio: MARTES }, 404, "PISTA_NO_ENCONTRADA"],
    ["socio-003", { pistaId: "pista-1", inicio: "2027-01-05T10:00" }, 400, "FRANJA_INVALIDA"],
    ["socio-003", { pistaId: "pista-1", inicio: "05/01/2027 10:30" }, 400, "FRANJA_INVALIDA"],
    ["socio-011", { pistaId: "pista-1", inicio: MARTES }, 409, "CUOTA_INACTIVA"],
    ["socio-003", { pistaId: "pista-4", inicio: MARTES }, 409, "PISTA_CERRADA"],
    ["socio-003", { pistaId: "pista-1", inicio: "2027-01-04T09:00" }, 409, "FRANJA_PASADA"],
    ["socio-003", { pistaId: "pista-2", inicio: "2027-01-05T19:30" }, 409, "FRANJA_NO_DISPONIBLE"],
    ["socio-007", { pistaId: "pista-1", inicio: MARTES }, 409, "LIMITE_DE_RESERVAS"],
  ];
  for (const [socioId, cuerpo, http, codigo] of casos) {
    const caso = `${socioId} ${JSON.stringify(cuerpo)}`;
    esError(await pedirPartido(api, socioId, cuerpo), http, codigo, `partido: ${caso}`);
    esError(await api.pedir("POST", "/api/reservas", { cuerpo: { socioId, ...cuerpo } }), http, codigo, `reserva: ${caso}`);
  }
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  assert.deepEqual(estado.partidos, []);
  assert.equal((await api.pedir("GET", "/api/reservas?desde=2027-01-01")).cuerpo.total, 4, "no se ha reservado nada más");
  const creado = await crearPartido(api, "socio-003", { pistaId: "pista-1", inicio: MARTES });
  assert.deepEqual((await reservasDe(api, "socio-003")).map((r: any) => r.id), [creado.reservaId]);
}));

test("C4 · nivelMin y nivelMax van los dos o ninguno, con niveles válidos y nivelMin menor o igual que nivelMax (si no, 400)", () => conApi(async (api) => {
  await fijarNivel(api, "socio-003", 3);
  const franjaLibre = { pistaId: "pista-1", inicio: MARTES };
  const malos = [
    { nivelMin: 3 }, { nivelMax: 4 }, { nivelMin: 3, nivelMax: null }, { nivelMin: null, nivelMax: 4 }, { nivelMin: 4, nivelMax: 3 },
    { nivelMin: 0.5, nivelMax: 3 }, { nivelMin: 3, nivelMax: 7.5 }, { nivelMin: 0, nivelMax: 8 }, { nivelMin: 2.25, nivelMax: 4 },
    { nivelMin: "2", nivelMax: "4" }, { nivelMin: true, nivelMax: 4 },
  ];
  for (const rango of malos) {
    esError(await pedirPartido(api, "socio-003", { ...franjaLibre, ...rango }), 400, "DATOS_INVALIDOS", JSON.stringify(rango));
  }
  assert.deepEqual(await reservasDe(api, "socio-003"), []);
  const igual = await crearPartido(api, "socio-003", { ...franjaLibre, nivelMin: 3, nivelMax: 3 });
  assert.deepEqual([igual.nivelMin, igual.nivelMax], [3, 3]);
  const amplio = await crearPartido(api, "socio-003", { pistaId: "pista-2", inicio: MARTES, nivelMin: 1, nivelMax: 7 });
  assert.deepEqual([amplio.nivelMin, amplio.nivelMax], [1, 7]);
  // Sin rango, el organizador no necesita nivel. Mandar los dos a null es lo mismo que no mandarlos.
  const sinRango = await crearPartido(api, "socio-006", { pistaId: "pista-3", inicio: MARTES });
  assert.deepEqual([sinRango.nivelMin, sinRango.nivelMax], [null, null]);
  const conNulls = await crearPartido(api, "socio-006", { pistaId: "pista-3", inicio: "2027-01-05T12:00", nivelMin: null, nivelMax: null });
  assert.deepEqual([conNulls.nivelMin, conNulls.nivelMax], [null, null]);
}));

test("C4 · con rango, el organizador tiene que tener nivel (NIVEL_SIN_DEFINIR) y estar dentro, con los extremos incluidos", () => conApi(async (api) => {
  esError(await pedirPartido(api, "socio-003", { pistaId: "pista-1", inicio: MARTES, nivelMin: 2, nivelMax: 4 }), 409, "NIVEL_SIN_DEFINIR");
  await fijarNivel(api, "socio-003", 4.5);
  esError(await pedirPartido(api, "socio-003", { pistaId: "pista-1", inicio: MARTES, nivelMin: 2, nivelMax: 4 }), 409, "NIVEL_FUERA_DE_RANGO");
  esError(await pedirPartido(api, "socio-003", { pistaId: "pista-1", inicio: MARTES, nivelMin: 5, nivelMax: 6 }), 409, "NIVEL_FUERA_DE_RANGO");
  assert.deepEqual(await reservasDe(api, "socio-003"), []);
  assert.equal((await crearPartido(api, "socio-003", { pistaId: "pista-1", inicio: MARTES, nivelMin: 2, nivelMax: 4.5 })).nivelMax, 4.5);
  assert.equal((await crearPartido(api, "socio-003", { pistaId: "pista-2", inicio: MARTES, nivelMin: 4.5, nivelMax: 6 })).nivelMin, 4.5);
}));

test("C5 · el partido crea una reserva confirmada del organizador, con el importe de siempre y partidoId, y su franja sale reservada", () => conApi(async (api) => {
  const p = await crearPartido(api, "socio-003", { pistaId: "pista-1", inicio: "2027-01-05T19:30" });
  const reserva = await leerReserva(api, p.reservaId);
  assert.deepEqual(reserva, {
    id: p.reservaId, socioId: "socio-003", pistaId: "pista-1", inicio: "2027-01-05T19:30", fin: "2027-01-05T21:00",
    estado: "confirmada", importe: 2800, notas: "", partidoId: p.id,
  });
  const lista = await api.pedir("GET", "/api/reservas?fecha=2027-01-05&pista=pista-1");
  assert.deepEqual(lista.cuerpo.reservas, [reserva]);
  assert.equal(await franja(api, "pista-1", "2027-01-05T19:30"), "reservada");
  esError(await pedirReserva(api, "socio-006", "pista-1", "2027-01-05T19:30"), 409, "FRANJA_NO_DISPONIBLE");
}));

test("C6 · POST /api/partidos responde 201 con el partido abierto, y GET /api/partidos/:id lo devuelve (si no existe, 404)", () => conApi(async (api) => {
  await fijarNivel(api, "socio-003", 3.5);
  const r = await pedirPartido(api, "socio-003", { pistaId: "pista-3", inicio: MARTES, nivelMin: 3, nivelMax: 4 });
  assert.equal(r.status, 201, r.texto);
  const p = r.cuerpo.partido;
  assert.equal(typeof p.id, "string");
  assert.deepEqual({ ...p, id: undefined }, {
    id: undefined, reservaId: (await reservasDe(api, "socio-003"))[0].id, pistaId: "pista-3", inicio: MARTES, fin: "2027-01-05T12:00",
    organizador: "socio-003", jugadores: ["socio-003"], plazasLibres: 3, nivelMin: 3, nivelMax: 4, estado: "abierto",
    importe: 1200, importePorJugador: 300, penalizaciones: [],
  });
  const consulta = await api.pedir("GET", `/api/partidos/${p.id}`);
  assert.equal(consulta.status, 200, consulta.texto);
  assert.deepEqual(consulta.cuerpo.partido, p);
  esError(await api.pedir("GET", "/api/partidos/P-9999"), 404, "PARTIDO_NO_ENCONTRADO");
  for (const nombre of ["unirse", "salir", "cancelar"] as const) {
    esError(await accion(api, "P-9999", nombre, "socio-003"), 404, "PARTIDO_NO_ENCONTRADO", nombre);
  }
}));

test("C7 · importePorJugador es la cuarta parte del importe de la reserva, redondeada al céntimo hacia arriba", () => conApi(async (api) => {
  const casos: [string, string, string, number, number][] = [
    ["socio-003", "pista-1", "2027-01-05T10:30", 1800, 450],
    ["socio-003", "pista-2", "2027-01-05T19:30", 2800, 700],
    ["socio-006", "pista-3", "2027-01-05T12:00", 1200, 300],
    ["socio-006", "pista-3", "2027-01-09T12:00", 2000, 500],
  ];
  for (const [socioId, pistaId, inicio, importe, porJugador] of casos) {
    const p = await crearPartido(api, socioId, { pistaId, inicio });
    assert.deepEqual([p.importe, p.importePorJugador], [importe, porJugador], `${pistaId} ${inicio}`);
    assert.equal((await leerReserva(api, p.reservaId)).importe, importe);
  }
  // Los precios del club son múltiplos de 4 céntimos, así que el redondeo se prueba con la función que lo calcula.
  assert.deepEqual([1800, 1801, 1802, 1803, 1805, 2799, 1].map(importePorJugador), [450, 451, 451, 451, 452, 700, 1]);
}));

test("C8 · unirse añade a quien llama al final de jugadores y le quita una plaza al partido; con el cuarto, completo", () => conApi(async (api) => {
  const p = await crearPartido(api, "socio-003", { pistaId: "pista-1", inicio: MARTES });
  const pasos = [];
  for (const socioId of ["socio-008", "socio-006", "socio-001"]) {
    const r = await accion(api, p.id, "unirse", socioId);
    assert.equal(r.status, 200, r.texto);
    pasos.push([r.cuerpo.partido.jugadores, r.cuerpo.partido.plazasLibres, r.cuerpo.partido.estado]);
  }
  assert.deepEqual(pasos, [
    [["socio-003", "socio-008"], 2, "abierto"],
    [["socio-003", "socio-008", "socio-006"], 1, "abierto"],
    [["socio-003", "socio-008", "socio-006", "socio-001"], 0, "completo"],
  ]);
  const consulta = await leerPartido(api, p.id);
  assert.deepEqual([consulta.jugadores, consulta.plazasLibres, consulta.estado], pasos[2]);
}));

test("C9 · nadie se une a un partido completo o cancelado, ni quien ya juega en él o no tiene la cuota al día", () => conApi(async (api) => {
  const p = await crearPartido(api, "socio-003", { pistaId: "pista-1", inicio: MARTES });
  esError(await accion(api, p.id, "unirse", "socio-003"), 409, "YA_APUNTADO", "el organizador");
  await unirse(api, p.id, "socio-006");
  esError(await accion(api, p.id, "unirse", "socio-006"), 409, "YA_APUNTADO");
  esError(await accion(api, p.id, "unirse", "socio-011"), 409, "CUOTA_INACTIVA");
  await unirse(api, p.id, "socio-007", "socio-008");
  esError(await accion(api, p.id, "unirse", "socio-009"), 409, "PARTIDO_COMPLETO");
  const q = await crearPartido(api, "socio-001", { pistaId: "pista-2", inicio: MARTES });
  await cancelar(api, q.id, "socio-001");
  esError(await accion(api, q.id, "unirse", "socio-009"), 409, "PARTIDO_CANCELADO");
  assert.deepEqual((await leerPartido(api, p.id)).jugadores, ["socio-003", "socio-006", "socio-007", "socio-008"]);
  assert.deepEqual((await leerPartido(api, q.id)).jugadores, ["socio-001"]);
}));

test("C10 · con rango, quien se une tiene que tener nivel y estar dentro, extremos incluidos; sin rango, se une cualquiera", () => conApi(async (api) => {
  await fijarNivel(api, "socio-003", 3.5);
  const p = await crearPartido(api, "socio-003", { pistaId: "pista-1", inicio: MARTES, nivelMin: 3, nivelMax: 4.5 });
  esError(await accion(api, p.id, "unirse", "socio-006"), 409, "NIVEL_SIN_DEFINIR");
  await fijarNivel(api, "socio-006", 2.5);
  esError(await accion(api, p.id, "unirse", "socio-006"), 409, "NIVEL_FUERA_DE_RANGO");
  await fijarNivel(api, "socio-007", 5);
  esError(await accion(api, p.id, "unirse", "socio-007"), 409, "NIVEL_FUERA_DE_RANGO");
  await fijarNivel(api, "socio-008", 3);
  await fijarNivel(api, "socio-009", 4.5);
  assert.deepEqual((await unirse(api, p.id, "socio-008", "socio-009")).jugadores, ["socio-003", "socio-008", "socio-009"]);
  const sinRango = await crearPartido(api, "socio-001", { pistaId: "pista-2", inicio: MARTES });
  assert.deepEqual((await unirse(api, sinRango.id, "socio-010", "socio-007")).jugadores, ["socio-001", "socio-010", "socio-007"]);
}));

test("C11 · el límite de 3 cuenta los partidos en los que se juega sin organizarlos: al unirse, al reservar y al crear un partido", () => conApi(async (api) => {
  const partidos = [];
  for (const [i, organizador] of ["socio-001", "socio-006", "socio-007", "socio-008"].entries()) {
    partidos.push(await crearPartido(api, organizador, { pistaId: "pista-1", inicio: `2027-01-0${5 + i}T19:30` }));
  }
  // Dos partidos de otros y una reserva: 3.
  await unirse(api, partidos[0].id, "socio-003");
  await unirse(api, partidos[1].id, "socio-003");
  const reserva = await reservar(api, "socio-003", "pista-3", "2027-01-05T12:00");
  esError(await accion(api, partidos[2].id, "unirse", "socio-003"), 409, "LIMITE_DE_RESERVAS");
  esError(await pedirReserva(api, "socio-003", "pista-3", "2027-01-06T12:00"), 409, "LIMITE_DE_RESERVAS");
  esError(await pedirPartido(api, "socio-003", { pistaId: "pista-2", inicio: "2027-01-06T12:00" }), 409, "LIMITE_DE_RESERVAS");
  assert.deepEqual((await leerPartido(api, partidos[2].id)).jugadores, ["socio-007"]);
  // Tres partidos de otros: 3.
  assert.equal((await api.pedir("POST", `/api/reservas/${reserva.id}/cancelar`)).status, 200);
  await unirse(api, partidos[2].id, "socio-003");
  esError(await accion(api, partidos[3].id, "unirse", "socio-003"), 409, "LIMITE_DE_RESERVAS");
  esError(await pedirReserva(api, "socio-003", "pista-3", "2027-01-06T12:00"), 409, "LIMITE_DE_RESERVAS");
  esError(await pedirPartido(api, "socio-003", { pistaId: "pista-2", inicio: "2027-01-06T12:00" }), 409, "LIMITE_DE_RESERVAS");
  // Al salir de un partido vuelve a tener sitio.
  await salir(api, partidos[1].id, "socio-003");
  await reservar(api, "socio-003", "pista-3", "2027-01-06T12:00");
}));

test("C11 · los partidos que organiza cuentan por su reserva, y los cancelados y los que han empezado no cuentan", () => conApi(async (api) => {
  for (const dia of ["05", "06", "07"]) await crearPartido(api, "socio-003", { pistaId: "pista-1", inicio: `2027-01-${dia}T19:30` });
  esError(await pedirPartido(api, "socio-003", { pistaId: "pista-1", inicio: "2027-01-08T19:30" }), 409, "LIMITE_DE_RESERVAS");
  esError(await pedirReserva(api, "socio-003", "pista-3", "2027-01-08T12:00"), 409, "LIMITE_DE_RESERVAS");
  const otro = await crearPartido(api, "socio-006", { pistaId: "pista-2", inicio: "2027-01-08T19:30" });
  esError(await accion(api, otro.id, "unirse", "socio-003"), 409, "LIMITE_DE_RESERVAS");

  const empieza = await crearPartido(api, "socio-007", { pistaId: "pista-3", inicio: MARTES });
  const seCancela = await crearPartido(api, "socio-008", { pistaId: "pista-3", inicio: "2027-01-06T10:30" });
  await unirse(api, empieza.id, "socio-010", "socio-001", "socio-002");
  await unirse(api, seCancela.id, "socio-010");
  await unirse(api, otro.id, "socio-010");
  esError(await pedirReserva(api, "socio-010", "pista-3", "2027-01-07T10:30"), 409, "LIMITE_DE_RESERVAS");
  await cancelar(api, seCancela.id, "socio-008");
  await reservar(api, "socio-010", "pista-3", "2027-01-07T10:30");
  esError(await pedirReserva(api, "socio-010", "pista-3", "2027-01-08T10:30"), 409, "LIMITE_DE_RESERVAS");
  await reloj(api, "2027-01-05T11:00"); // el partido completo del martes a las 10:30 ya ha empezado
  assert.equal((await leerPartido(api, empieza.id)).estado, "completo");
  await reservar(api, "socio-010", "pista-3", "2027-01-08T10:30");
}));

test("C12 · salir quita a quien llama de jugadores y deja libre su plaza; un partido completo vuelve a abierto", () => conApi(async (api) => {
  const p = await crearPartido(api, "socio-003", { pistaId: "pista-1", inicio: MARTES });
  await unirse(api, p.id, "socio-006", "socio-007", "socio-008");
  const fuera = await salir(api, p.id, "socio-007");
  assert.deepEqual([fuera.jugadores, fuera.plazasLibres, fuera.estado, fuera.penalizaciones], [["socio-003", "socio-006", "socio-008"], 1, "abierto", []]);
  assert.deepEqual(await leerPartido(api, p.id), fuera);
  esError(await accion(api, p.id, "salir", "socio-007"), 409, "NO_APUNTADO", "ya ha salido");
  esError(await accion(api, p.id, "salir", "socio-009"), 409, "NO_APUNTADO", "nunca ha jugado");
  assert.deepEqual((await unirse(api, p.id, "socio-007")).jugadores, ["socio-003", "socio-006", "socio-008", "socio-007"]);
}));

test("C12 · de un partido cancelado o que ya ha empezado no se puede salir", () => conApi(async (api) => {
  const p = await crearPartido(api, "socio-003", { pistaId: "pista-1", inicio: MARTES });
  await unirse(api, p.id, "socio-006");
  await cancelar(api, p.id, "socio-003");
  esError(await accion(api, p.id, "salir", "socio-006", { forzar: true }), 409, "PARTIDO_CANCELADO");
  const q = await crearPartido(api, "socio-001", { pistaId: "pista-2", inicio: MARTES });
  await unirse(api, q.id, "socio-007", "socio-008", "socio-009");
  await reloj(api, MARTES);
  esError(await accion(api, q.id, "salir", "socio-007", { forzar: true }), 409, "FRANJA_PASADA");
  const despues = await leerPartido(api, q.id);
  assert.deepEqual([despues.estado, despues.jugadores.length, despues.penalizaciones], ["completo", 4, []]);
}));

test("C13 · con menos de 24 horas, salir solo con forzar: true, y quien sale paga su parte", () => conApi(async (api) => {
  const p = await crearPartido(api, "socio-003", { pistaId: "pista-1", inicio: "2027-01-05T19:30" });
  await unirse(api, p.id, "socio-006", "socio-007", "socio-008");
  await reloj(api, "2027-01-04T19:30"); // faltan 24 horas justas: sale gratis
  assert.deepEqual((await salir(api, p.id, "socio-006", { forzar: true })).penalizaciones, []);
  await reloj(api, "2027-01-04T20:00"); // faltan 23 horas y media
  esError(await accion(api, p.id, "salir", "socio-007"), 409, "FUERA_DE_PLAZO");
  esError(await accion(api, p.id, "salir", "socio-007", { forzar: false }), 409, "FUERA_DE_PLAZO");
  esError(await accion(api, p.id, "salir", "socio-007", { forzar: "sí" }), 400, "DATOS_INVALIDOS");
  assert.deepEqual((await leerPartido(api, p.id)).jugadores, ["socio-003", "socio-007", "socio-008"]);
  const tarde = await salir(api, p.id, "socio-007", { forzar: true });
  assert.deepEqual([tarde.jugadores, tarde.estado], [["socio-003", "socio-008"], "abierto"]);
  assert.deepEqual(tarde.penalizaciones, [{ socioId: "socio-007", importe: 700 }]);
  assert.deepEqual((await salir(api, p.id, "socio-008", { forzar: true })).penalizaciones, [
    { socioId: "socio-007", importe: 700 },
    { socioId: "socio-008", importe: 700 },
  ]);
  const reserva = await leerReserva(api, p.reservaId);
  assert.deepEqual([reserva.estado, reserva.penalizacion], ["confirmada", undefined]);
}));

test("C14 · el organizador no puede salir de su partido", () => conApi(async (api) => {
  const p = await crearPartido(api, "socio-003", { pistaId: "pista-1", inicio: MARTES });
  await unirse(api, p.id, "socio-006");
  esError(await accion(api, p.id, "salir", "socio-003"), 409, "ORGANIZADOR_NO_PUEDE_SALIR");
  esError(await accion(api, p.id, "salir", "socio-003", { forzar: true }), 409, "ORGANIZADOR_NO_PUEDE_SALIR");
  const igual = await leerPartido(api, p.id);
  assert.deepEqual([igual.estado, igual.jugadores, igual.organizador], ["abierto", ["socio-003", "socio-006"], "socio-003"]);
}));

test("C15 · cancelar deja el partido cancelado por el organizador y cancela su reserva, así que la franja queda libre", () => conApi(async (api) => {
  const p = await crearPartido(api, "socio-003", { pistaId: "pista-1", inicio: MARTES });
  await unirse(api, p.id, "socio-006", "socio-007", "socio-008");
  const cancelado = await cancelar(api, p.id, "socio-003");
  assert.deepEqual([cancelado.estado, cancelado.motivo, cancelado.penalizaciones], ["cancelado", "organizador", []]);
  assert.deepEqual(await leerPartido(api, p.id), cancelado);
  const reserva = await leerReserva(api, p.reservaId);
  assert.deepEqual([reserva.estado, reserva.penalizacion], ["cancelada", undefined]);
  assert.equal(await franja(api, "pista-1", MARTES), "libre");
  await reservar(api, "socio-009", "pista-1", MARTES);
  esError(await accion(api, p.id, "cancelar", "socio-003"), 409, "PARTIDO_CANCELADO");
  esError(await accion(api, p.id, "cancelar", GESTOR, { forzar: true }), 409, "PARTIDO_CANCELADO");
}));

test("C15 · con menos de 24 horas, cancelar solo con forzar: true, y la reserva lleva el 100 %; lo que ha empezado no se cancela", () => conApi(async (api) => {
  const p = await crearPartido(api, "socio-003", { pistaId: "pista-1", inicio: "2027-01-05T09:00" }); // faltan 23 horas
  esError(await accion(api, p.id, "cancelar", "socio-003"), 409, "FUERA_DE_PLAZO");
  esError(await accion(api, p.id, "cancelar", GESTOR, { forzar: false }), 409, "FUERA_DE_PLAZO");
  esError(await accion(api, p.id, "cancelar", "socio-003", { forzar: 1 }), 400, "DATOS_INVALIDOS");
  assert.equal((await leerReserva(api, p.reservaId)).estado, "confirmada");
  const cancelado = await cancelar(api, p.id, "socio-003", { forzar: true });
  assert.deepEqual([cancelado.estado, cancelado.motivo], ["cancelado", "organizador"]);
  const reserva = await leerReserva(api, p.reservaId);
  assert.deepEqual([reserva.estado, reserva.penalizacion], ["cancelada", 1800]);

  const q = await crearPartido(api, "socio-006", { pistaId: "pista-2", inicio: MARTES });
  await unirse(api, q.id, "socio-007", "socio-008", "socio-009");
  await reloj(api, MARTES);
  esError(await accion(api, q.id, "cancelar", "socio-006", { forzar: true }), 409, "FRANJA_PASADA");
  assert.equal((await leerPartido(api, q.id)).estado, "completo");
  assert.equal((await leerReserva(api, q.reservaId)).estado, "confirmada");
}));

test("C16 · un partido que no está completo cuando faltan 6 horas o menos se cancela solo, sin penalización para nadie", () => conApi(async (api) => {
  const p = await crearPartido(api, "socio-003", { pistaId: "pista-1", inicio: "2027-01-05T18:00" });
  await unirse(api, p.id, "socio-006", "socio-007");
  const lleno = await crearPartido(api, "socio-008", { pistaId: "pista-2", inicio: "2027-01-05T18:00" });
  await unirse(api, lleno.id, "socio-009", "socio-010", "socio-001");
  const antes = await crearPartido(api, "socio-002", { pistaId: "pista-3", inicio: MARTES });
  await reloj(api, "2027-01-05T11:59"); // el de las 10:30 ya ha empezado y al de las 18:00 le faltan 6 horas y 1 minuto
  const yaEmpezado = await leerPartido(api, antes.id);
  assert.deepEqual([yaEmpezado.estado, yaEmpezado.motivo], ["cancelado", "incompleto"]);
  assert.equal((await leerReserva(api, antes.reservaId)).estado, "cancelada");
  assert.equal((await leerPartido(api, p.id)).estado, "abierto");
  assert.deepEqual(await listar(api), [p.id]);

  await reloj(api, "2027-01-05T12:00"); // faltan 6 horas justas
  const cancelado = await leerPartido(api, p.id);
  assert.deepEqual([cancelado.estado, cancelado.motivo, cancelado.penalizaciones], ["cancelado", "incompleto", []]);
  const reserva = await leerReserva(api, p.reservaId);
  assert.deepEqual([reserva.estado, reserva.penalizacion], ["cancelada", undefined]);
  const delDia = (await api.pedir("GET", "/api/reservas?fecha=2027-01-05&pista=pista-1")).cuerpo.reservas;
  assert.deepEqual(delDia.map((r: any) => [r.id, r.estado]), [[p.reservaId, "cancelada"]]);
  assert.equal(await franja(api, "pista-1", "2027-01-05T18:00"), "libre");
  assert.deepEqual(await listar(api), []);
  assert.deepEqual(await listar(api, "?fecha=2027-01-05"), []);
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  assert.equal(estado.partidos.find((x: any) => x.id === p.id).estado, "cancelado");
  esError(await accion(api, p.id, "unirse", "socio-004"), 409, "PARTIDO_CANCELADO");
  esError(await accion(api, p.id, "salir", "socio-006", { forzar: true }), 409, "PARTIDO_CANCELADO");
  esError(await accion(api, p.id, "cancelar", "socio-003", { forzar: true }), 409, "PARTIDO_CANCELADO");
  await reservar(api, "socio-004", "pista-1", "2027-01-05T18:00");

  // El completo sigue completo, también cuando empieza.
  await reloj(api, "2027-01-05T18:30");
  assert.equal((await leerPartido(api, lleno.id)).estado, "completo");
  assert.equal((await leerReserva(api, lleno.reservaId)).estado, "confirmada");
  assert.equal(await franja(api, "pista-2", "2027-01-05T18:00"), "reservada");
}));

test("C16 · si deja de estar completo cuando ya faltan 6 horas o menos, también se cancela solo", () => conApi(async (api) => {
  const p = await crearPartido(api, "socio-003", { pistaId: "pista-1", inicio: "2027-01-05T18:00" });
  await unirse(api, p.id, "socio-006", "socio-007", "socio-008");
  await reloj(api, "2027-01-05T14:00"); // faltan 4 horas
  assert.equal((await leerPartido(api, p.id)).estado, "completo");
  const r = await salir(api, p.id, "socio-007", { forzar: true });
  assert.deepEqual([r.estado, r.motivo, r.jugadores], ["cancelado", "incompleto", ["socio-003", "socio-006", "socio-008"]]);
  // Quien sale con menos de 24 horas paga su parte; la cancelación automática no le cobra nada a nadie más.
  assert.deepEqual(r.penalizaciones, [{ socioId: "socio-007", importe: 700 }]);
  assert.deepEqual(await leerPartido(api, p.id), r);
  const reserva = await leerReserva(api, p.reservaId);
  assert.deepEqual([reserva.estado, reserva.penalizacion], ["cancelada", undefined]);
  assert.equal(await franja(api, "pista-1", "2027-01-05T18:00"), "libre");
}));

test("C16 · un partido solo se puede crear si faltan más de 6 horas para su franja (si no, DEMASIADO_TARDE)", () => conApi(async (api) => {
  await reloj(api, "2027-01-05T04:30");
  esError(await pedirPartido(api, "socio-003", { pistaId: "pista-1", inicio: "2027-01-05T10:30" }), 409, "DEMASIADO_TARDE", "6 horas justas");
  esError(await pedirPartido(api, "socio-003", { pistaId: "pista-1", inicio: "2027-01-05T09:00" }), 409, "DEMASIADO_TARDE", "4 horas y media");
  assert.deepEqual(await reservasDe(api, "socio-003"), []);
  await reservar(api, "socio-006", "pista-1", "2027-01-05T09:00"); // una reserva normal sí se puede
  await reloj(api, "2027-01-05T04:29");
  const p = await crearPartido(api, "socio-003", { pistaId: "pista-1", inicio: "2027-01-05T10:30" }); // 6 horas y 1 minuto
  assert.equal(p.estado, "abierto");
  await reloj(api, "2027-01-05T04:30");
  assert.equal((await leerPartido(api, p.id)).estado, "cancelado");
}));

test("C17 · la reserva de un partido no se cancela con POST /api/reservas/:id/cancelar (ES_UN_PARTIDO), sino con el partido", () => conApi(async (api) => {
  const p = await crearPartido(api, "socio-003", { pistaId: "pista-1", inicio: MARTES });
  esError(await api.pedir("POST", `/api/reservas/${p.reservaId}/cancelar`), 409, "ES_UN_PARTIDO");
  esError(await api.pedir("POST", `/api/reservas/${p.reservaId}/cancelar`, { cuerpo: { forzar: true, motivo: "Lluvia" } }), 409, "ES_UN_PARTIDO");
  const reserva = await leerReserva(api, p.reservaId);
  assert.deepEqual([reserva.estado, reserva.motivoCancelacion], ["confirmada", undefined]);
  assert.equal((await leerPartido(api, p.id)).estado, "abierto");
  await cancelar(api, p.id, "socio-003");
  assert.equal((await leerReserva(api, p.reservaId)).estado, "cancelada");
  esError(await api.pedir("POST", `/api/reservas/${p.reservaId}/cancelar`), 409, "ES_UN_PARTIDO");
}));

test("C18 · GET /api/partidos devuelve los partidos abiertos que no han empezado, por orden de inicio", () => conApi(async (api) => {
  const miercoles = await crearPartido(api, "socio-003", { pistaId: "pista-1", inicio: "2027-01-06T19:30" });
  const martes = await crearPartido(api, "socio-006", { pistaId: "pista-1", inicio: MARTES });
  const completo = await crearPartido(api, "socio-007", { pistaId: "pista-2", inicio: "2027-01-05T12:00" });
  await unirse(api, completo.id, "socio-001", "socio-002", "socio-004");
  const cancelado = await crearPartido(api, "socio-008", { pistaId: "pista-3", inicio: "2027-01-05T12:00" });
  await cancelar(api, cancelado.id, "socio-008");
  const tarde = await crearPartido(api, "socio-009", { pistaId: "pista-3", inicio: "2027-01-05T19:30" });
  await unirse(api, tarde.id, "socio-010");
  const r = await api.pedir("GET", "/api/partidos");
  assert.equal(r.status, 200, r.texto);
  assert.deepEqual(r.cuerpo.partidos.map((p: any) => p.id), [martes.id, tarde.id, miercoles.id]);
  assert.deepEqual(r.cuerpo.partidos[1], await leerPartido(api, tarde.id));
  // Si alguien sale del completo, vuelve a salir. Y al llenarse otro, deja de salir.
  await salir(api, completo.id, "socio-002");
  await unirse(api, tarde.id, "socio-005", "socio-002");
  assert.deepEqual(await listar(api), [martes.id, completo.id, miercoles.id]);
  // Al pasar el martes, los que quedaban del martes ya no salen.
  await reloj(api, "2027-01-06T08:00");
  assert.deepEqual(await listar(api), [miercoles.id]);
}));

test("C19 · con fecha, solo los de ese día; con nivel, los que no tienen rango y los que lo incluyen; si no valen, 400", () => conApi(async (api) => {
  await fijarNivel(api, "socio-003", 3);
  await fijarNivel(api, "socio-006", 5);
  const libre = await crearPartido(api, "socio-001", { pistaId: "pista-1", inicio: "2027-01-05T10:30" });
  const bajo = await crearPartido(api, "socio-003", { pistaId: "pista-2", inicio: "2027-01-05T19:30", nivelMin: 2, nivelMax: 3.5 });
  const alto = await crearPartido(api, "socio-006", { pistaId: "pista-1", inicio: "2027-01-06T10:30", nivelMin: 4.5, nivelMax: 6 });
  assert.deepEqual(await listar(api), [libre.id, bajo.id, alto.id]);
  assert.deepEqual(await listar(api, "?fecha=2027-01-05"), [libre.id, bajo.id]);
  assert.deepEqual(await listar(api, "?fecha=2027-01-06"), [alto.id]);
  assert.deepEqual(await listar(api, "?fecha=2027-01-07"), []);
  assert.deepEqual(await listar(api, "?nivel=1"), [libre.id]);
  assert.deepEqual(await listar(api, "?nivel=2"), [libre.id, bajo.id]);
  assert.deepEqual(await listar(api, "?nivel=3.5"), [libre.id, bajo.id]);
  assert.deepEqual(await listar(api, "?nivel=4"), [libre.id]);
  assert.deepEqual(await listar(api, "?nivel=4.5"), [libre.id, alto.id]);
  assert.deepEqual(await listar(api, "?nivel=6"), [libre.id, alto.id]);
  assert.deepEqual(await listar(api, "?nivel=7"), [libre.id]);
  assert.deepEqual(await listar(api, "?fecha=2027-01-06&nivel=6"), [alto.id]);
  assert.deepEqual(await listar(api, "?fecha=2027-01-05&nivel=5"), [libre.id]);
  for (const consulta of [
    "?fecha=2027-1-5", "?fecha=05-01-2027", "?fecha=martes", "?fecha=2027-02-30", "?fecha=2027-13-01", "?fecha=",
    "?nivel=0", "?nivel=0.5", "?nivel=7.5", "?nivel=8", "?nivel=3.3", "?nivel=4,5", "?nivel=alto", "?nivel=", "?fecha=2027-01-05&nivel=9",
  ]) {
    esError(await api.pedir("GET", `/api/partidos${consulta}`), 400, "DATOS_INVALIDOS", consulta);
  }
}));

test("C20 · reservar y cancelar reservas normales funciona como antes", () => conApi(async (api) => {
  await crearPartido(api, "socio-006", { pistaId: "pista-2", inicio: "2027-01-05T09:00" });
  const normal = await reservar(api, "socio-003", "pista-1", MARTES);
  assert.deepEqual(normal, {
    id: normal.id, socioId: "socio-003", pistaId: "pista-1", inicio: MARTES, fin: "2027-01-05T12:00", estado: "confirmada", importe: 1800, notas: "",
  });
  const gratis = await api.pedir("POST", `/api/reservas/${normal.id}/cancelar`, { cuerpo: { motivo: "Lluvia" } });
  assert.deepEqual([gratis.status, gratis.cuerpo.reserva.estado, gratis.cuerpo.reserva.penalizacion, gratis.cuerpo.reserva.motivoCancelacion],
    [200, "cancelada", undefined, "Lluvia"]);
  esError(await api.pedir("POST", `/api/reservas/${normal.id}/cancelar`), 409, "YA_CANCELADA");
  const pronto = await reservar(api, "socio-003", "pista-1", "2027-01-05T09:00"); // faltan 23 horas
  esError(await api.pedir("POST", `/api/reservas/${pronto.id}/cancelar`), 409, "FUERA_DE_PLAZO");
  assert.equal((await api.pedir("POST", `/api/reservas/${pronto.id}/cancelar`, { cuerpo: { forzar: true } })).cuerpo.reserva.penalizacion, 1800);
  esError(await api.pedir("POST", "/api/reservas/R-9999/cancelar"), 404, "RESERVA_NO_ENCONTRADA");
  for (const dia of ["06", "07", "08"]) await reservar(api, "socio-003", "pista-3", `2027-01-${dia}T12:00`);
  esError(await pedirReserva(api, "socio-003", "pista-3", "2027-01-09T12:00"), 409, "LIMITE_DE_RESERVAS");
}));

test("C21 · el README documenta los partidos abiertos", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  for (const texto of [
    "nivel", "PATCH /api/socios/:id", "POST /api/partidos", "GET /api/partidos", "GET /api/partidos/:id",
    "POST /api/partidos/:id/unirse", "POST /api/partidos/:id/salir", "POST /api/partidos/:id/cancelar",
    "importePorJugador", "cuarta parte", "24 horas", "6 horas", "forzar", "incompleto", "partidoId",
    "SIN_PERMISO", "NIVEL_SIN_DEFINIR", "NIVEL_FUERA_DE_RANGO", "PARTIDO_NO_ENCONTRADO", "PARTIDO_COMPLETO", "PARTIDO_CANCELADO",
    "YA_APUNTADO", "NO_APUNTADO", "ORGANIZADOR_NO_PUEDE_SALIR", "DEMASIADO_TARDE", "ES_UN_PARTIDO",
  ]) {
    assert.ok(readme.includes(texto), texto);
  }
});
