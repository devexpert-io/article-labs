// Reservas de 60, 90 o 120 minutos (docs/specs/duraciones.md), probadas a través de la API: un test o más por criterio.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

/** Lunes 1 de febrero de 2027: toda esa semana está libre (la semilla acaba el 24 de noviembre de 2026). */
const LUNES = "2027-02-01T10:00";
/** Miércoles 3 de febrero de 2027. */
const DIA = "2027-02-03";

/** Una API solo para la prueba, con su propio estado, que se cierra al terminar. */
async function conApi(ahora: string | undefined, prueba: (api: Api) => Promise<void>) {
  const api = await arrancarApi(ahora ? { AHORA: ahora } : {});
  try {
    await prueba(api);
  } finally {
    api.cerrar();
  }
}

/** Socios con la cuota al día y sin reservas futuras: cada uno puede hacer hasta 3 reservas. */
async function sociosLibres(api: Api): Promise<string[]> {
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  const conFuturas = new Set(estado.reservas.filter((r: any) => r.estado === "confirmada" && r.inicio > estado.ahora).map((r: any) => r.socioId));
  return estado.socios.filter((s: any) => s.cuotaActiva && s.rol === "socio" && !conFuturas.has(s.id)).map((s: any) => s.id);
}

/** Crea reservas, cada una con un socio distinto con sitio. */
async function reservador(api: Api) {
  const socios = await sociosLibres(api);
  let turno = 0;
  return {
    intentar(pistaId: string, inicio: string, duracion?: unknown): Promise<Respuesta> {
      const socioId = socios[turno++ % socios.length];
      return api.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio, ...(duracion === undefined ? {} : { duracion }) } });
    },
    async reservar(pistaId: string, inicio: string, duracion?: number): Promise<any> {
      const r = await this.intentar(pistaId, inicio, duracion);
      assert.equal(r.status, 201, `${pistaId} ${inicio} ${duracion ?? ""}: ${r.texto}`);
      return r.cuerpo.reserva;
    },
  };
}

function esError(r: Respuesta, http: number, codigo: string, caso = "") {
  assert.equal(r.status, http, `${caso} ${r.texto}`);
  assert.equal(r.cuerpo.error.codigo, codigo, `${caso} ${r.texto}`);
}

async function huecos(api: Api, fecha: string, pistaId: string): Promise<string[]> {
  const r = await api.pedir("GET", `/api/disponibilidad?fecha=${fecha}`);
  return r.cuerpo.pistas.find((p: any) => p.pistaId === pistaId).huecos.map((h: any) => `${h.inicio.slice(11)}-${h.fin.slice(11)}`);
}

async function estados(api: Api, fecha: string, pistaId: string): Promise<string> {
  const r = await api.pedir("GET", `/api/disponibilidad?fecha=${fecha}&pista=${pistaId}`);
  return r.cuerpo.pistas[0].franjas.map((f: any) => f.estado[0]).join("");
}

test("C1 · duracion vale 60, 90 o 120, con 90 por defecto, y cualquier otro valor responde 400 DURACION_INVALIDA", () =>
  conApi(LUNES, async (api) => {
    const club = await reservador(api);
    assert.equal((await club.reservar("pista-1", `${DIA}T09:00`)).duracion, 90);
    assert.equal((await club.reservar("pista-1", `${DIA}T11:00`, 60)).duracion, 60);
    assert.equal((await club.reservar("pista-1", `${DIA}T13:00`, 90)).duracion, 90);
    assert.equal((await club.reservar("pista-1", `${DIA}T15:00`, 120)).duracion, 120);
    for (const duracion of [0, 30, 45, 100, 150, 180, -60, 60.5, "90", null, true]) {
      esError(await club.intentar("pista-2", `${DIA}T10:00`, duracion), 400, "DURACION_INVALIDA", String(duracion));
    }
    assert.equal((await api.pedir("GET", `/api/reservas?fecha=${DIA}&pista=pista-2`)).cuerpo.total, 0);
  }));

test("C2 · una reserva empieza en punto o y media, no antes de las 09:00, y termina como muy tarde a las 22:30", () =>
  conApi(LUNES, async (api) => {
    const club = await reservador(api);
    await club.reservar("pista-1", `${DIA}T09:30`, 60);
    await club.reservar("pista-1", `${DIA}T11:00`, 90);
    await club.reservar("pista-1", `${DIA}T21:30`, 60);
    await club.reservar("pista-2", `${DIA}T21:00`);
    await club.reservar("pista-3", `${DIA}T20:30`, 120);
    const invalidas: [string, number | undefined][] = [
      ["09:15", 60], ["10:45", 90], ["12:10", undefined], ["08:30", 60], ["08:00", 120],
      ["22:00", 60], ["21:30", 90], ["21:30", undefined], ["21:00", 120], ["22:30", 60],
    ];
    for (const [hora, duracion] of invalidas) {
      esError(await club.intentar("pista-3", `${DIA}T${hora}`, duracion), 400, "FRANJA_INVALIDA", `${hora} ${duracion}`);
    }
  }));

test("C3 · fin es inicio más la duración", () =>
  conApi(LUNES, async (api) => {
    const club = await reservador(api);
    const casos: [string, number | undefined, string][] = [["09:00", 60, "10:00"], ["10:30", 120, "12:30"], ["13:30", undefined, "15:00"], ["17:30", 90, "19:00"], ["20:30", 120, "22:30"]];
    for (const [hora, duracion, fin] of casos) {
      const reserva = await club.reservar("pista-1", `${DIA}T${hora}`, duracion);
      assert.equal(reserva.fin, `${DIA}T${fin}`);
      assert.equal((await api.pedir("GET", `/api/reservas/${reserva.id}`)).cuerpo.reserva.fin, `${DIA}T${fin}`);
    }
  }));

test("C4 · una reserva no puede solaparse con ninguna reserva confirmada de la pista, nueva o de las que ya existían", () =>
  conApi(undefined, async (api) => {
    const club = await reservador(api);
    // La semilla tiene en la pista 1, el jueves 19, 12:00-13:30, 18:00-19:30 y 19:30-21:00.
    for (const [hora, duracion] of [["11:30", 60], ["13:00", 60], ["11:00", 120], ["19:00", 60], ["20:30", 120], ["12:30", 90]] as const) {
      esError(await club.intentar("pista-1", `2026-11-19T${hora}`, duracion), 409, "FRANJA_NO_DISPONIBLE", hora);
    }
    // Pegadas, sin solaparse.
    await club.reservar("pista-1", "2026-11-19T10:00", 120);
    await club.reservar("pista-1", "2026-11-19T13:30", 60);
    await club.reservar("pista-1", "2026-11-19T17:00", 60);
    await club.reservar("pista-1", "2026-11-19T21:00", 60);
    // Entre reservas nuevas.
    await club.reservar("pista-1", "2026-11-20T12:00", 120);
    esError(await club.intentar("pista-1", "2026-11-20T13:30", 60), 409, "FRANJA_NO_DISPONIBLE");
    esError(await club.intentar("pista-1", "2026-11-20T11:00", 90), 409, "FRANJA_NO_DISPONIBLE");
    await club.reservar("pista-1", "2026-11-20T14:00", 60);
    await club.reservar("pista-2", "2026-11-20T12:30", 60);
  }));

test("C4 · las reservas canceladas no ocupan la pista", () =>
  conApi(LUNES, async (api) => {
    const club = await reservador(api);
    const cancelada = await club.reservar("pista-1", `${DIA}T12:00`, 120);
    assert.equal((await api.pedir("POST", `/api/reservas/${cancelada.id}/cancelar`)).status, 200);
    await club.reservar("pista-1", `${DIA}T12:30`, 60);
    await club.reservar("pista-1", `${DIA}T11:00`, 90);
  }));

test("C5 · el precio se calcula por minutos, de valle o de punta, y se redondea al céntimo más cercano", () =>
  conApi(LUNES, async (api) => {
    const club = await reservador(api);
    const casos: [string, string, number, number][] = [
      ["pista-1", "2027-02-02T17:30", 90, 2467], // el ejemplo de la spec: 600 + 1866,67
      ["pista-1", "2027-02-02T10:00", 60, 1200],
      ["pista-3", "2027-02-02T10:00", 120, 1600],
      ["pista-1", "2027-02-03T18:30", 60, 1867], // 1866,67
      ["pista-3", "2027-02-03T18:30", 60, 1333], // 1333,33
      ["pista-2", "2027-02-03T17:00", 120, 3067], // 1200 + 1866,67
      ["pista-3", "2027-02-04T17:30", 60, 1067], // 400 + 666,67
      ["pista-1", "2027-02-04T16:00", 120, 2400], // termina a las 18:00: todo valle
      ["pista-1", "2027-02-06T10:00", 60, 1867], // sábado: todo punta
      ["pista-3", "2027-02-07T16:30", 120, 2667], // domingo: todo punta
    ];
    for (const [pistaId, inicio, duracion, importe] of casos) {
      const reserva = await club.reservar(pistaId, inicio, duracion);
      assert.equal(reserva.importe, importe, `${pistaId} ${inicio} ${duracion}`);
    }
  }));

test("C6 · una reserva de 90 minutos a una de las horas de siempre cuesta lo mismo que antes", () =>
  conApi(LUNES, async (api) => {
    const club = await reservador(api);
    const horas = ["09:00", "10:30", "12:00", "13:30", "15:00", "16:30", "18:00", "19:30", "21:00"];
    for (const [i, hora] of horas.entries()) {
      const punta = hora >= "18:00";
      // Las alternas, en días distintos: así no se tocan.
      assert.equal((await club.reservar("pista-1", `2027-02-0${3 + (i % 2)}T${hora}`)).importe, punta ? 2800 : 1800, hora);
      assert.equal((await club.reservar("pista-3", `2027-02-0${3 + (i % 2)}T${hora}`, 90)).importe, punta ? 2000 : 1200, hora);
      assert.equal((await club.reservar("pista-2", `2027-02-0${6 + (i % 2)}T${hora}`)).importe, 2800, `fin de semana ${hora}`);
    }
  }));

test("C7 · todas las reservas devuelven duracion, también las que ya existían, que son de 90 minutos", () =>
  conApi(undefined, async (api) => {
    const todas = await api.pedir("GET", "/api/reservas?limite=100&pagina=1");
    assert.ok(todas.cuerpo.reservas.every((r: any) => r.duracion === 90));
    assert.equal((await api.pedir("GET", "/api/reservas/R-0001")).cuerpo.reserva.duracion, 90);
    assert.equal((await api.pedir("POST", "/api/reservas/R-0525/cancelar")).cuerpo.reserva.duracion, 90);
    const club = await reservador(api);
    const nueva = await club.reservar("pista-3", "2026-11-25T10:00", 120);
    assert.equal((await api.pedir("GET", `/api/reservas/${nueva.id}`)).cuerpo.reserva.duracion, 120);
    const delDia = await api.pedir("GET", "/api/reservas?fecha=2026-11-25");
    assert.deepEqual(delDia.cuerpo.reservas.map((r: any) => r.duracion), [120]);
  }));

test("C8 · una franja está reservada si cualquier reserva confirmada de la pista se solapa con ella, aunque sea en parte", () =>
  conApi(LUNES, async (api) => {
    const club = await reservador(api);
    await club.reservar("pista-1", `${DIA}T11:00`, 60); // 10:30-12:00
    await club.reservar("pista-1", `${DIA}T13:00`, 120); // 12:00-13:30 y 13:30-15:00
    const tarde = await club.reservar("pista-1", `${DIA}T17:30`, 60); // 16:30-18:00 y 18:00-19:30
    assert.equal(await estados(api, DIA, "pista-1"), "lrrrlrrll");
    await api.pedir("POST", `/api/reservas/${tarde.id}/cancelar`);
    assert.equal(await estados(api, DIA, "pista-1"), "lrrrlllll");
    assert.equal(await estados(api, "2026-11-19", "pista-1"), "llrlllrrl", "las de la semilla, como siempre");
  }));

test("C9 · huecos: los intervalos libres más largos entre las 09:00 y las 22:30, ordenados y sin mirar la hora actual", () =>
  conApi(LUNES, async (api) => {
    const club = await reservador(api);
    assert.deepEqual(await huecos(api, DIA, "pista-1"), ["09:00-22:30"]);
    await club.reservar("pista-1", `${DIA}T17:30`, 90);
    await club.reservar("pista-1", `${DIA}T09:30`, 60);
    await club.reservar("pista-1", `${DIA}T12:00`, 120);
    await club.reservar("pista-1", `${DIA}T21:30`, 60);
    const cancelada = await club.reservar("pista-1", `${DIA}T15:00`, 60);
    await api.pedir("POST", `/api/reservas/${cancelada.id}/cancelar`);
    const esperados = ["09:00-09:30", "10:30-12:00", "14:00-17:30", "19:00-21:30"];
    assert.deepEqual(await huecos(api, DIA, "pista-1"), esperados);
    await api.pedir("POST", "/_reloj", { cuerpo: { ahora: `${DIA}T16:00` } });
    assert.deepEqual(await huecos(api, DIA, "pista-1"), esperados, "sin tener en cuenta la hora actual");
    assert.deepEqual(await huecos(api, DIA, "pista-4"), [], "una pista cerrada no tiene huecos");
  }));

test("C9 · los huecos cuentan las reservas que ya existían, y las seguidas no dejan huecos entre ellas", () =>
  conApi(undefined, async (api) => {
    assert.deepEqual(await huecos(api, "2026-11-22", "pista-2"), ["09:00-10:30", "12:00-15:00", "21:00-22:30"]);
    assert.deepEqual(await huecos(api, "2026-11-18", "pista-1"), ["09:00-16:30", "19:30-22:30"]);
  }));

test("C10 · las reglas del club siguen, sea cual sea la duración", () =>
  conApi(LUNES, async (api) => {
    const estado = (await api.pedir("GET", "/_estado")).cuerpo;
    const sinCuota = estado.socios.find((s: any) => !s.cuotaActiva).id;
    const [socio] = await sociosLibres(api);
    const pedir = (pistaId: string, inicio: string, duracion: number) => api.pedir("POST", "/api/reservas", { cuerpo: { socioId: socio, pistaId, inicio, duracion } });
    esError(await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: sinCuota, pistaId: "pista-1", inicio: `${DIA}T10:00`, duracion: 60 } }), 409, "CUOTA_INACTIVA");
    esError(await pedir("pista-4", `${DIA}T10:00`, 120), 409, "PISTA_CERRADA");
    esError(await pedir("pista-1", "2027-02-01T09:30", 60), 409, "FRANJA_PASADA");
    assert.equal((await pedir("pista-1", `${DIA}T10:00`, 60)).status, 201);
    assert.equal((await pedir("pista-1", `${DIA}T12:00`, 120)).status, 201);
    assert.equal((await pedir("pista-1", `${DIA}T17:30`, 90)).status, 201);
    esError(await pedir("pista-2", `${DIA}T10:00`, 60), 409, "LIMITE_DE_RESERVAS");
  }));

test("C11 · cancelar no cambia: gratis hasta 24 horas antes y después solo con forzar y el 100 % del importe", () =>
  conApi(LUNES, async (api) => {
    const club = await reservador(api);
    const gratis = await club.reservar("pista-1", `${DIA}T17:30`, 60);
    const penalizada = await club.reservar("pista-2", `${DIA}T17:00`, 120);
    await api.pedir("POST", "/_reloj", { cuerpo: { ahora: "2027-02-02T17:30" } });
    const r1 = await api.pedir("POST", `/api/reservas/${gratis.id}/cancelar`);
    assert.equal(r1.cuerpo.reserva.estado, "cancelada");
    assert.equal(r1.cuerpo.reserva.penalizacion, undefined);
    esError(await api.pedir("POST", `/api/reservas/${penalizada.id}/cancelar`), 409, "FUERA_DE_PLAZO");
    const r2 = await api.pedir("POST", `/api/reservas/${penalizada.id}/cancelar`, { cuerpo: { forzar: true } });
    assert.equal(r2.cuerpo.reserva.penalizacion, penalizada.importe);
    assert.equal(penalizada.importe, 3067);
  }));

test("C12 · el README explica las duraciones, los inicios, el precio por minutos, los huecos y el error nuevo", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  for (const texto of ["duracion", "60, 90 o 120", "y media", "22:30", "minuto", "huecos", "DURACION_INVALIDA"]) {
    assert.ok(readme.includes(texto), `el README no menciona ${texto}`);
  }
});
