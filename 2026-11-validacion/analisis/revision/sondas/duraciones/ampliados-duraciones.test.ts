// Tests ampliados de la spec `duraciones`: un test por clase de defecto de comportamiento confirmado en la revisión a mano
// de las falsas alarmas, para probarlo en todos los estados del encargo. Caja negra: solo la API HTTP, con /_estado (socios)
// para preparar. Cada prueba arranca su propia API, con el reloj fijado y la hora de Madrid (la del club), como los ocultos.
//
// X1 · inicios con minutos 60 o 90 (haiku r1-r3 los aceptan con 201, deepseek-r2 responde 500).
// X2 · inicios con horas que no existen, como 99:00 (deepseek-r3 y luna-r3 los aceptan con un fin 100:00).
// X3 · GET /api/disponibilidad con una fecha que no existe (deepseek-r2 responde 500, la base 200).
// X4 · reservas con una fecha que no existe, que la base ya aceptaba (sol-r2 devuelve duracion null).
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
    /** Intenta crear la reserva (sin duracion si es undefined) con un socio con sitio. Devuelve también el socio. */
    async intentar(pistaId: string, inicio: string, duracion?: number): Promise<{ r: Respuesta; socioId: string }> {
      const socioId = [...sitio].find(([, n]) => n > 0)?.[0];
      assert.ok(socioId, "no queda ningún socio con sitio para reservar");
      const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio, ...(duracion === undefined ? {} : { duracion }) } });
      if (r.status === 201) sitio.set(socioId, sitio.get(socioId)! - 1);
      return { r, socioId };
    },
  };
}

type Caso = [pistaId: string, inicio: string, duracion: number | undefined];

function nombre([pistaId, inicio, duracion]: Caso): string {
  return `${pistaId} ${inicio} con ${duracion ?? "la duración por defecto"}`;
}

/** Cada caso responde 400 FRANJA_INVALIDA y, al final, no se ha creado ninguna reserva esos días. Junta todos los fallos. */
async function sonInvalidos(api: Api, casos: Caso[]) {
  const club = await crearClub(api);
  const fallos: string[] = [];
  for (const caso of casos) {
    const { r } = await club.intentar(...caso);
    if (r.status !== 400 || r.cuerpo?.error?.codigo !== "FRANJA_INVALIDA") fallos.push(`${nombre(caso)}: ${r.status} ${r.texto.slice(0, 160)}`);
  }
  for (const dia of new Set(casos.map(([, inicio]) => inicio.slice(0, 10)))) {
    const r = await api.pedir("GET", `/api/reservas?fecha=${dia}`);
    if (r.status !== 200 || r.cuerpo.total !== 0) fallos.push(`el ${dia} no debía crearse ninguna reserva: ${r.status} ${r.texto.slice(0, 160)}`);
  }
  assert.deepEqual(fallos, [], "esperaba 400 FRANJA_INVALIDA en todos los casos y ninguna reserva creada");
}

test("X1 · un inicio con minutos 60 o 90 no es en punto ni y media: responde 400 FRANJA_INVALIDA y no crea la reserva (C2)", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  // Cada caso, en una pista y un día en los que no hay nada más: aquí solo cuenta el inicio.
  await sonInvalidos(api, [
    ["pista-1", "2027-02-03T10:60", 60],
    ["pista-2", "2027-02-03T09:60", 60],
    ["pista-3", "2027-02-03T09:90", 60],
    ["pista-1", "2027-02-04T12:60", 90],
    ["pista-2", "2027-02-04T20:60", 60],
    ["pista-3", "2027-02-04T08:60", 60],
    ["pista-1", "2027-02-05T08:90", 120],
    ["pista-2", "2027-02-05T10:60", undefined],
    ["pista-3", "2027-02-05T13:90", 120],
    ["pista-1", "2027-02-06T11:60", 60], // sábado
  ]);
}));

test("X2 · un inicio con una hora que no existe, de 24 a 99, responde 400 FRANJA_INVALIDA y no crea la reserva (C2)", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  await sonInvalidos(api, [
    ["pista-1", "2027-02-03T99:00", 60],
    ["pista-2", "2027-02-03T98:00", 120],
    ["pista-3", "2027-02-03T99:30", 90],
    ["pista-1", "2027-02-04T99:00", 120],
    ["pista-2", "2027-02-04T98:30", 120],
    ["pista-3", "2027-02-04T24:00", 60],
    ["pista-1", "2027-02-05T25:30", 60],
    ["pista-2", "2027-02-05T99:00", undefined],
  ]);
}));

test("X3 · GET /api/disponibilidad con una fecha que no existe no responde 500 (C8)", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  // La base responde 200 con sus franjas. Rechazar la fecha con un 400 también vale: la spec no dice nada de ellas.
  const fallos: string[] = [];
  for (const fecha of ["2027-13-01", "2027-11-32", "0000-00-00", "2027-02-30", "2027-99-99", "2027-00-10", "2027-04-31"]) {
    for (const ruta of [`/api/disponibilidad?fecha=${fecha}`, `/api/disponibilidad?fecha=${fecha}&pista=pista-1`]) {
      const r = await api.pedir("GET", ruta);
      if (r.status !== 200 && r.status !== 400) fallos.push(`${ruta}: ${r.status} ${r.texto.slice(0, 160)}`);
    }
  }
  assert.deepEqual(fallos, [], "esperaba 200 o 400");
}));

test("X4 · una reserva con una fecha que no existe no responde 500 y, si se crea, devuelve su duración al crearla, al consultarla y en el listado (C7)", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  // La base ya acepta estas fechas (201): rechazarlas también vale. Lo que no vale es un 500 ni una reserva sin su duracion.
  const club = await crearClub(api);
  const casos: Caso[] = [
    ["pista-1", "2027-13-01T09:00", 60],
    ["pista-2", "2027-13-02T09:00", 90],
    ["pista-3", "2027-13-03T09:00", 120],
    ["pista-1", "2027-99-99T12:00", undefined],
    ["pista-2", "2027-02-30T10:00", 60],
    ["pista-3", "2027-04-31T17:30", 120],
    ["pista-1", "2027-00-10T10:00", 60],
  ];
  const fallos: string[] = [];
  for (const caso of casos) {
    const esperada = caso[2] ?? 90;
    const { r, socioId } = await club.intentar(...caso);
    if (r.status >= 500) {
      fallos.push(`${nombre(caso)}: ${r.status} ${r.texto.slice(0, 160)}`);
      continue;
    }
    if (r.status !== 201) continue;
    const id = r.cuerpo.reserva?.id;
    if (r.cuerpo.reserva?.duracion !== esperada) fallos.push(`${nombre(caso)}, al crearla: ${JSON.stringify(r.cuerpo.reserva)}`);
    const detalle = await api.pedir("GET", `/api/reservas/${id}`);
    if (detalle.status !== 200 || detalle.cuerpo.reserva?.duracion !== esperada) fallos.push(`${nombre(caso)}, al consultarla: ${detalle.status} ${detalle.texto.slice(0, 160)}`);
    const listado = await api.pedir("GET", `/api/reservas?socio=${socioId}&limite=100`);
    const enLista = listado.status === 200 ? listado.cuerpo.reservas.find((x: { id: string }) => x.id === id) : undefined;
    if (enLista?.duracion !== esperada) fallos.push(`${nombre(caso)}, en el listado: ${listado.status} ${JSON.stringify(enLista ?? listado.texto.slice(0, 160))}`);
  }
  assert.deepEqual(fallos, [], "ningún 500 y, si se crea, la reserva lleva su duracion en minutos");
}));
