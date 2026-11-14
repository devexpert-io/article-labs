// Las series de reservas fijas (docs/specs/reservas-fijas.md), probadas a través de la API.
// Cada prueba arranca su propia API con el reloj en enero de 2027: nadie tiene reservas futuras y todas las franjas están libres.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

const GESTOR = "socio-040";
/** Lunes 4 de enero de 2027 a las 10:00. */
const ENERO = "2027-01-04T10:00";

const abiertas = new Set<Api>();
after(() => abiertas.forEach((api) => api.cerrar()));

async function conApi(prueba: (api: Api) => Promise<void>, entorno: Record<string, string> = {}) {
  const api = await arrancarApi({ AHORA: ENERO, TZ: "UTC", ...entorno });
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

/** Pide crear una serie como `socio` (el gestor si no se dice; null, sin cabecera X-Socio). */
const pedirSerie = (api: Api, cuerpo: Record<string, unknown>, socio: string | null = GESTOR) =>
  api.pedir("POST", "/api/series", { cuerpo, socio: socio ?? undefined });

async function crearSerie(api: Api, cuerpo: Record<string, unknown>) {
  const r = await pedirSerie(api, cuerpo);
  assert.equal(r.status, 201, r.texto);
  return r.cuerpo.serie;
}

async function reservar(api: Api, socioId: string, pistaId: string, inicio: string) {
  const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio } });
  assert.equal(r.status, 201, r.texto);
  return r.cuerpo.reserva;
}

async function reserva(api: Api, id: string) {
  return (await api.pedir("GET", `/api/reservas/${id}`)).cuerpo.reserva;
}

async function reloj(api: Api, ahora: string) {
  assert.equal((await api.pedir("POST", "/_reloj", { cuerpo: { ahora } })).status, 200);
}

/** Las reservas de un socio desde 2027, por orden de inicio. */
async function reservasDe(api: Api, socioId: string) {
  const r = await api.pedir("GET", `/api/reservas?socio=${socioId}&desde=2027-01-01&limite=100`);
  return r.cuerpo.reservas.sort((a: any, b: any) => a.inicio.localeCompare(b.inicio));
}

test("permisos: solo un gestor crea, consulta y cancela series", () => conApi(async (api) => {
  const cuerpo = { socioId: "socio-003", pistaId: "pista-1", inicio: "2027-01-05T10:30", semanas: 3 };
  esError(await pedirSerie(api, cuerpo, null), 401, "NO_IDENTIFICADO");
  esError(await pedirSerie(api, cuerpo, "socio-003"), 403, "SIN_PERMISO");
  assert.deepEqual(await reservasDe(api, "socio-003"), []);
  const serie = await crearSerie(api, cuerpo);
  esError(await api.pedir("GET", `/api/series/${serie.id}`), 401, "NO_IDENTIFICADO");
  esError(await api.pedir("GET", `/api/series/${serie.id}`, { socio: "socio-003" }), 403, "SIN_PERMISO");
  esError(await api.pedir("POST", `/api/series/${serie.id}/cancelar`), 401, "NO_IDENTIFICADO");
  esError(await api.pedir("POST", `/api/series/${serie.id}/cancelar`, { socio: "socio-003", cuerpo: { forzar: true } }), 403, "SIN_PERMISO");
  for (const id of serie.reservas) assert.equal((await reserva(api, id)).estado, "confirmada");
}));

test("datos: semanas de 2 a 12, socio y pista que existen y una franja válida que no ha empezado", () => conApi(async (api) => {
  const valida = { socioId: "socio-003", pistaId: "pista-1", inicio: "2027-01-05T10:30" };
  for (const semanas of [1, 13, 0, 2.5, "4", null, undefined]) {
    esError(await pedirSerie(api, { ...valida, semanas }), 400, "DATOS_INVALIDOS");
  }
  esError(await pedirSerie(api, { ...valida, semanas: 3, socioId: "socio-999" }), 404, "SOCIO_NO_ENCONTRADO");
  esError(await pedirSerie(api, { ...valida, semanas: 3, pistaId: "pista-9" }), 404, "PISTA_NO_ENCONTRADA");
  esError(await pedirSerie(api, { ...valida, semanas: 3, inicio: "2027-01-05T10:00" }), 400, "FRANJA_INVALIDA");
  esError(await pedirSerie(api, { ...valida, semanas: 3, inicio: "2027-01-04T09:00" }), 409, "FRANJA_PASADA");
  assert.deepEqual(await reservasDe(api, "socio-003"), []);
  assert.equal((await pedirSerie(api, { ...valida, semanas: 2 })).status, 201);
  assert.equal((await pedirSerie(api, { ...valida, socioId: "socio-006", pistaId: "pista-2", semanas: 12 })).status, 201);
}));

for (const TZ of ["Europe/Madrid", "UTC"]) {
  test(`una reserva cada 7 días a la misma hora local, también con el cambio de hora (TZ=${TZ})`, () => conApi(async (api) => {
    await reloj(api, "2027-03-01T10:00");
    await crearSerie(api, { socioId: "socio-003", pistaId: "pista-1", inicio: "2027-03-23T19:30", semanas: 3 });
    await crearSerie(api, { socioId: "socio-006", pistaId: "pista-2", inicio: "2027-10-26T09:00", semanas: 2 });
    const marzo = (await reservasDe(api, "socio-003")).map((r: any) => [r.pistaId, r.inicio, r.fin, r.estado]);
    assert.deepEqual(marzo, [
      ["pista-1", "2027-03-23T19:30", "2027-03-23T21:00", "confirmada"],
      ["pista-1", "2027-03-30T19:30", "2027-03-30T21:00", "confirmada"],
      ["pista-1", "2027-04-06T19:30", "2027-04-06T21:00", "confirmada"],
    ]);
    const octubre = (await reservasDe(api, "socio-006")).map((r: any) => r.inicio);
    assert.deepEqual(octubre, ["2027-10-26T09:00", "2027-11-02T09:00"]);
  }, { TZ }));
}

test("semanas ocupadas: se saltan con FRANJA_NO_DISPONIBLE y, si lo están todas, SERIE_VACIA", () => conApi(async (api) => {
  await reservar(api, "socio-006", "pista-1", "2027-01-12T10:30");
  const serie = await crearSerie(api, { socioId: "socio-003", pistaId: "pista-1", inicio: "2027-01-05T10:30", semanas: 3 });
  assert.deepEqual(serie.saltadas, [{ inicio: "2027-01-12T10:30", codigo: "FRANJA_NO_DISPONIBLE" }]);
  assert.deepEqual((await reservasDe(api, "socio-003")).map((r: any) => r.inicio), ["2027-01-05T10:30", "2027-01-19T10:30"]);
  esError(await pedirSerie(api, { socioId: "socio-007", pistaId: "pista-1", inicio: "2027-01-05T10:30", semanas: 3 }), 409, "SERIE_VACIA");
  assert.deepEqual(await reservasDe(api, "socio-007"), []);
}));

test("sin cuota al día o con la pista cerrada no se crea nada", () => conApi(async (api) => {
  esError(await pedirSerie(api, { socioId: "socio-011", pistaId: "pista-1", inicio: "2027-01-05T10:30", semanas: 3 }), 409, "CUOTA_INACTIVA");
  esError(await pedirSerie(api, { socioId: "socio-003", pistaId: "pista-4", inicio: "2027-01-05T10:30", semanas: 3 }), 409, "PISTA_CERRADA");
  assert.deepEqual(await reservasDe(api, "socio-011"), []);
  assert.deepEqual(await reservasDe(api, "socio-003"), []);
}));

test("las reservas de la serie quedan fuera del límite de 3 reservas futuras, que sigue valiendo para las normales", () => conApi(async (api) => {
  for (const dia of ["06", "07", "08"]) await reservar(api, "socio-003", "pista-3", `2027-01-${dia}T12:00`);
  const serie = await crearSerie(api, { socioId: "socio-003", pistaId: "pista-1", inicio: "2027-01-05T10:30", semanas: 4 });
  assert.equal(serie.reservas.length, 4);
  await crearSerie(api, { socioId: "socio-006", pistaId: "pista-2", inicio: "2027-01-05T10:30", semanas: 4 });
  for (const dia of ["06", "07", "08"]) await reservar(api, "socio-006", "pista-3", `2027-01-${dia}T13:30`);
  esError(await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-006", pistaId: "pista-3", inicio: "2027-01-09T13:30" } }), 409, "LIMITE_DE_RESERVAS");
}));

test("descuento: un 10 % menos desde 8 semanas, precio normal con menos", () => conApi(async (api) => {
  const ocho = await crearSerie(api, { socioId: "socio-003", pistaId: "pista-2", inicio: "2027-01-07T19:30", semanas: 8 });
  const siete = await crearSerie(api, { socioId: "socio-006", pistaId: "pista-1", inicio: "2027-01-05T10:30", semanas: 7 });
  for (const id of ocho.reservas) assert.equal((await reserva(api, id)).importe, 2520);
  for (const id of siete.reservas) assert.equal((await reserva(api, id)).importe, 1800);
}));

test("respuesta y consulta: la serie con sus reservas y sus saltadas, y cada reserva con serieId", () => conApi(async (api) => {
  await reservar(api, "socio-006", "pista-2", "2027-01-14T18:00");
  const serie = await crearSerie(api, { socioId: "socio-003", pistaId: "pista-2", inicio: "2027-01-07T18:00", semanas: 3 });
  assert.equal(typeof serie.id, "string");
  assert.deepEqual({ ...serie, id: undefined, reservas: undefined }, {
    id: undefined, socioId: "socio-003", pistaId: "pista-2", inicio: "2027-01-07T18:00", semanas: 3, reservas: undefined,
    saltadas: [{ inicio: "2027-01-14T18:00", codigo: "FRANJA_NO_DISPONIBLE" }],
  });
  assert.equal(serie.reservas.length, 2);
  const completas = await Promise.all(serie.reservas.map((id: string) => reserva(api, id)));
  assert.deepEqual(completas.map((r) => [r.inicio, r.serieId]), [["2027-01-07T18:00", serie.id], ["2027-01-21T18:00", serie.id]]);
  const consulta = await api.pedir("GET", `/api/series/${serie.id}`, { socio: GESTOR });
  assert.equal(consulta.status, 200, consulta.texto);
  assert.deepEqual(consulta.cuerpo.serie, { ...serie, reservas: completas });
  esError(await api.pedir("GET", "/api/series/S-9999", { socio: GESTOR }), 404, "SERIE_NO_ENCONTRADA");
}));

test("cancelar la serie: sin penalización con 24 horas o más, pendientes las de menos y, con forzar, el 100 %", () => conApi(async (api) => {
  const normal = await reservar(api, "socio-003", "pista-1", "2027-01-08T12:00");
  const a = await crearSerie(api, { socioId: "socio-003", pistaId: "pista-1", inicio: "2027-01-05T10:30", semanas: 3 });
  const b = await crearSerie(api, { socioId: "socio-006", pistaId: "pista-2", inicio: "2027-01-05T10:30", semanas: 3 });
  await reloj(api, "2027-01-04T12:00"); // la primera semana empieza dentro de 22,5 horas
  const sinForzar = await api.pedir("POST", `/api/series/${a.id}/cancelar`, { socio: GESTOR });
  assert.equal(sinForzar.status, 200, sinForzar.texto);
  assert.deepEqual(sinForzar.cuerpo.canceladas.map((r: any) => [r.id, r.estado, r.penalizacion]), [[a.reservas[1], "cancelada", undefined], [a.reservas[2], "cancelada", undefined]]);
  assert.deepEqual(sinForzar.cuerpo.pendientes.map((r: any) => [r.id, r.estado]), [[a.reservas[0], "confirmada"]]);
  assert.equal((await reserva(api, normal.id)).estado, "confirmada");
  const forzada = await api.pedir("POST", `/api/series/${b.id}/cancelar`, { socio: GESTOR, cuerpo: { forzar: true } });
  assert.deepEqual(forzada.cuerpo.canceladas.map((r: any) => [r.id, r.penalizacion]), [[b.reservas[0], 1800], [b.reservas[1], undefined], [b.reservas[2], undefined]]);
  assert.deepEqual(forzada.cuerpo.pendientes, []);
}));

test("cancelar la serie no toca las que ya han empezado ni las canceladas", () => conApi(async (api) => {
  const serie = await crearSerie(api, { socioId: "socio-003", pistaId: "pista-1", inicio: "2027-01-05T10:30", semanas: 3 });
  const [primera, segunda, tercera] = serie.reservas;
  assert.equal((await api.pedir("POST", `/api/reservas/${segunda}/cancelar`, { cuerpo: { motivo: "Viaje" } })).status, 200);
  await reloj(api, "2027-01-11T12:00"); // la primera ya se jugó y la segunda (cancelada) empezaría en 22,5 horas
  const r = await api.pedir("POST", `/api/series/${serie.id}/cancelar`, { socio: GESTOR, cuerpo: { forzar: true } });
  assert.deepEqual(r.cuerpo.canceladas.map((x: any) => x.id), [tercera]);
  assert.equal((await reserva(api, primera)).estado, "confirmada");
  const cancelada = await reserva(api, segunda);
  assert.deepEqual([cancelada.estado, cancelada.penalizacion, cancelada.motivoCancelacion], ["cancelada", undefined, "Viaje"]);
}));

test("una reserva de la serie se cancela sola con las reglas de siempre y la serie sigue con las demás", () => conApi(async (api) => {
  const serie = await crearSerie(api, { socioId: "socio-003", pistaId: "pista-1", inicio: "2027-01-05T10:30", semanas: 3 });
  const [primera, segunda, tercera] = serie.reservas;
  assert.equal((await api.pedir("POST", `/api/reservas/${segunda}/cancelar`)).cuerpo.reserva.estado, "cancelada");
  await reloj(api, "2027-01-04T12:00");
  esError(await api.pedir("POST", `/api/reservas/${primera}/cancelar`), 409, "FUERA_DE_PLAZO");
  assert.equal((await api.pedir("POST", `/api/reservas/${primera}/cancelar`, { cuerpo: { forzar: true } })).cuerpo.reserva.penalizacion, 1800);
  const consulta = await api.pedir("GET", `/api/series/${serie.id}`, { socio: GESTOR });
  assert.deepEqual(consulta.cuerpo.serie.reservas.map((r: any) => [r.id, r.estado]), [[primera, "cancelada"], [segunda, "cancelada"], [tercera, "confirmada"]]);
}));

test("el README documenta las series", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  for (const texto of ["/api/series", "SERIE_VACIA", "SERIE_NO_ENCONTRADA", "SIN_PERMISO", "saltadas", "10 %"]) assert.ok(readme.includes(texto), texto);
});
