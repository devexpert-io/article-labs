// Tests ocultos de la spec `duraciones`: inicios válidos (C2). Una reserva empieza en punto o y media, no antes de las
// 09:00, y termina como muy tarde a las 22:30; si no, 400 FRANJA_INVALIDA. Caja negra: solo la API HTTP, con /_estado
// (socios) para preparar. Cada prueba arranca su propia API, con la hora de Madrid (la del club).
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

/** Si la API se cuelga, el test falla a los 30 segundos y la API se cierra. */
const OPCIONES = { timeout: 30_000 };
/** Lunes 1 de febrero de 2027: toda la semana siguiente está libre (la semilla acaba el 24 de noviembre de 2026). */
const LUNES = "2027-02-01T10:00";

async function conApi(t: TestContext, ahora: string, prueba: (api: Api) => Promise<void>): Promise<void> {
  const api = await arrancarApi({ TZ: "Europe/Madrid", AHORA: ahora });
  t.signal.addEventListener("abort", () => api.cerrar(), { once: true });
  try {
    await prueba(api);
  } finally {
    api.cerrar();
  }
}

/** Para crear reservas sin chocar con las reglas: cada una con un socio con la cuota al día (sin el gestor) y sitio. */
async function crearClub(api: Api) {
  // A esta hora no hay reservas futuras: cada socio tiene sitio para 3.
  const socios: { id: string; cuotaActiva: boolean; rol: string }[] = (await api.pedir("GET", "/_estado")).cuerpo.socios;
  const sitio = new Map(socios.filter((s) => s.cuotaActiva === true && s.rol === "socio").map((s) => [s.id, 3]));
  return {
    /** Intenta crear la reserva (sin duracion si es undefined) con un socio con sitio. */
    async intentar(pistaId: string, inicio: string, duracion?: number): Promise<Respuesta> {
      const socioId = [...sitio].find(([, n]) => n > 0)?.[0];
      assert.ok(socioId, "no queda ningún socio con sitio para reservar");
      const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio, ...(duracion === undefined ? {} : { duracion }) } });
      if (r.status === 201) sitio.set(socioId, sitio.get(socioId)! - 1);
      return r;
    },
  };
}

type Caso = [pistaId: string, inicio: string, duracion: number | undefined];

function nombre([pistaId, inicio, duracion]: Caso): string {
  return `${pistaId} ${inicio} con ${duracion ?? "la duración por defecto"}`;
}

async function sonValidos(api: Api, casos: Caso[]) {
  const club = await crearClub(api);
  for (const caso of casos) {
    const r = await club.intentar(...caso);
    assert.equal(r.status, 201, `${nombre(caso)}: ${r.status} ${r.texto.slice(0, 300)}`);
  }
}

/** Cada caso responde 400 FRANJA_INVALIDA y, al final, no se ha creado ninguna reserva esos días. */
async function sonInvalidos(api: Api, casos: Caso[]) {
  const club = await crearClub(api);
  for (const caso of casos) {
    const r = await club.intentar(...caso);
    assert.equal(r.status, 400, `${nombre(caso)}: esperaba 400 FRANJA_INVALIDA y llegó ${r.status}: ${r.texto.slice(0, 300)}`);
    assert.equal(r.cuerpo?.error?.codigo, "FRANJA_INVALIDA", `${nombre(caso)}: ${r.texto.slice(0, 300)}`);
  }
  const dias = new Set(casos.map(([, inicio]) => inicio.slice(0, 10)));
  for (const dia of dias) {
    const r = await api.pedir("GET", `/api/reservas?fecha=${dia}`);
    assert.equal(r.cuerpo.total, 0, `no se ha creado ninguna reserva el ${dia}: ${r.texto.slice(0, 300)}`);
  }
}

test("C2 · una reserva puede empezar en punto o y media desde las 09:00, también fuera de las horas de siempre", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  // Ninguna se toca con otra de su pista: los solapes son cosa del criterio 4.
  await sonValidos(api, [
    ["pista-1", "2027-02-03T09:00", 60],
    ["pista-2", "2027-02-03T09:00", 120],
    ["pista-3", "2027-02-03T09:30", 90],
    ["pista-1", "2027-02-03T11:30", 120],
    ["pista-3", "2027-02-03T13:00", 120],
    ["pista-2", "2027-02-03T14:30", undefined],
    ["pista-1", "2027-02-03T17:30", 90],
    ["pista-2", "2027-02-03T20:00", 60],
    ["pista-1", "2027-02-04T10:00", 60],
    ["pista-2", "2027-02-04T11:00", 60],
    ["pista-3", "2027-02-04T11:00", undefined],
    ["pista-3", "2027-02-06T09:30", 60], // sábado
    ["pista-1", "2027-02-07T16:00", 120], // domingo
  ]);
}));

test("C2 · si no empieza en punto o y media, 400 FRANJA_INVALIDA", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  await sonInvalidos(api, [
    ["pista-1", "2027-02-03T09:15", 60],
    ["pista-1", "2027-02-03T09:45", 90],
    ["pista-2", "2027-02-03T10:05", 120],
    ["pista-2", "2027-02-03T10:10", undefined],
    ["pista-3", "2027-02-03T12:59", 60],
    ["pista-3", "2027-02-03T13:01", 90],
    ["pista-1", "2027-02-03T18:20", 120],
    ["pista-2", "2027-02-03T20:15", 60],
    ["pista-3", "2027-02-03T16:45", undefined],
  ]);
}));

test("C2 · si empieza antes de las 09:00, 400 FRANJA_INVALIDA", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  await sonInvalidos(api, [
    ["pista-1", "2027-02-03T08:30", 60], // terminaría a las 09:30
    ["pista-2", "2027-02-03T08:00", 60],
    ["pista-3", "2027-02-03T08:30", 90],
    ["pista-1", "2027-02-03T07:30", 120],
    ["pista-2", "2027-02-03T08:30", undefined],
    ["pista-3", "2027-02-03T00:00", 60],
  ]);
}));

test("C2 · puede terminar justo a las 22:30: a las 21:30 con 60, a las 21:00 con 90 o sin duracion y a las 20:30 con 120", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  await sonValidos(api, [
    ["pista-1", "2027-02-03T21:30", 60],
    ["pista-2", "2027-02-03T21:00", 90],
    ["pista-3", "2027-02-03T20:30", 120],
    ["pista-1", "2027-02-04T21:00", undefined],
    ["pista-2", "2027-02-06T20:30", 120], // sábado
  ]);
}));

test("C2 · si termina después de las 22:30, 400 FRANJA_INVALIDA", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  await sonInvalidos(api, [
    ["pista-1", "2027-02-03T22:00", 60],
    ["pista-1", "2027-02-03T22:30", 60],
    ["pista-1", "2027-02-03T23:00", 60],
    ["pista-2", "2027-02-03T21:30", 90],
    ["pista-2", "2027-02-03T22:00", 90],
    ["pista-2", "2027-02-03T21:30", undefined],
    ["pista-3", "2027-02-03T21:00", 120],
    ["pista-3", "2027-02-03T21:30", 120],
    ["pista-3", "2027-02-03T22:00", 120],
  ]);
}));
