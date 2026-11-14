// Tests ocultos de la spec `duraciones`: sin solapes (C4). Una reserva no puede solaparse con ninguna reserva confirmada
// de la misma pista, tampoco con las de 90 minutos que ya existían; terminar justo cuando empieza otra no es solaparse y
// las canceladas no ocupan la pista. Caja negra: solo la API HTTP, con /_estado (socios) para preparar. Cada prueba
// arranca su propia API, con la hora de Madrid (la del club).
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
  fin: string;
  estado: string;
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
 * Para crear reservas sin chocar con las reglas: cada una con un socio con la cuota al día (sin el gestor) y sitio
 * para otra reserva futura (como mucho 3).
 */
async function crearClub(api: Api, ahora: string) {
  const socios: { id: string; cuotaActiva: boolean; rol: string }[] = (await api.pedir("GET", "/_estado")).cuerpo.socios;
  const futuras = new Map<string, number>();
  for (const r of await listarTodas(api, `desde=${ahora.slice(0, 10)}&estado=confirmada`)) {
    if (r.inicio > ahora) futuras.set(r.socioId, (futuras.get(r.socioId) ?? 0) + 1);
  }
  const sitio = new Map(socios.filter((s) => s.cuotaActiva === true && s.rol === "socio").map((s) => [s.id, 3 - (futuras.get(s.id) ?? 0)]));
  const club = {
    /** Intenta crear la reserva (sin duracion si es undefined) con un socio con sitio. */
    async intentar(pistaId: string, inicio: string, duracion?: number): Promise<Respuesta> {
      const socioId = [...sitio].find(([, n]) => n > 0)?.[0];
      assert.ok(socioId, "no queda ningún socio con sitio para reservar");
      const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio, ...(duracion === undefined ? {} : { duracion }) } });
      if (r.status === 201) sitio.set(socioId, sitio.get(socioId)! - 1);
      return r;
    },
    async reservar(pistaId: string, inicio: string, duracion?: number): Promise<Reserva> {
      const r = await club.intentar(pistaId, inicio, duracion);
      assert.equal(r.status, 201, `${pistaId} ${inicio} con ${duracion ?? "la duración por defecto"}: esperaba 201 y llegó ${r.status}: ${r.texto.slice(0, 300)}`);
      return r.cuerpo.reserva;
    },
    async seSolapa(pistaId: string, inicio: string, duracion?: number) {
      const r = await club.intentar(pistaId, inicio, duracion);
      const caso = `${pistaId} ${inicio} con ${duracion ?? "la duración por defecto"}`;
      assert.equal(r.status, 409, `${caso}: esperaba 409 FRANJA_NO_DISPONIBLE y llegó ${r.status}: ${r.texto.slice(0, 300)}`);
      assert.equal(r.cuerpo?.error?.codigo, "FRANJA_NO_DISPONIBLE", `${caso}: ${r.texto.slice(0, 300)}`);
    },
  };
  return club;
}

/** Las reservas confirmadas de una pista ese día, como "HH:MM-HH:MM", ordenadas. Solo para las de la semilla. */
async function ocupacion(api: Api, fecha: string, pistaId: string): Promise<string[]> {
  return (await listarTodas(api, `fecha=${fecha}&pista=${pistaId}&estado=confirmada`)).map((r) => `${r.inicio.slice(11)}-${r.fin.slice(11)}`).sort();
}

/** Los ids de las reservas de una pista ese día, para comprobar que un intento fallido no ha creado nada. */
async function ids(api: Api, fecha: string, pistaId: string): Promise<string[]> {
  return (await listarTodas(api, `fecha=${fecha}&pista=${pistaId}`)).map((r) => r.id).sort();
}

async function cancelar(api: Api, id: string) {
  const r = await api.pedir("POST", `/api/reservas/${id}/cancelar`, { cuerpo: {} });
  assert.equal(r.status, 200, `cancelar ${id}: ${r.texto.slice(0, 300)}`);
  assert.equal(r.cuerpo.reserva.estado, "cancelada");
}

test("C4 · una reserva no puede solaparse con otra confirmada de la misma pista, sea cual sea su duración", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  const club = await crearClub(api, LUNES);
  const dia = "2027-02-03";
  const larga = await club.reservar("pista-1", `${dia}T12:00`, 120); // 12:00-14:00
  const corta = await club.reservar("pista-2", `${dia}T12:00`, 60); // 12:00-13:00
  const contraLaDeDosHoras: [string, number | undefined][] = [
    ["11:30", 60], ["13:00", 60], ["12:30", 60], ["12:00", 60],
    ["11:00", 90], ["12:00", 90], ["13:30", 90], ["13:00", undefined], ["11:30", undefined],
    ["11:00", 120], ["12:00", 120], ["12:30", 120], ["13:30", 120],
  ];
  for (const [hora, duracion] of contraLaDeDosHoras) await club.seSolapa("pista-1", `${dia}T${hora}`, duracion);
  const contraLaDeUnaHora: [string, number | undefined][] = [["12:30", 60], ["11:30", 90], ["12:00", undefined], ["11:00", 120], ["11:30", 120]];
  for (const [hora, duracion] of contraLaDeUnaHora) await club.seSolapa("pista-2", `${dia}T${hora}`, duracion);
  assert.deepEqual(await ids(api, dia, "pista-1"), [larga.id], "los intentos no han creado nada en la pista 1");
  assert.deepEqual(await ids(api, dia, "pista-2"), [corta.id], "los intentos no han creado nada en la pista 2");
  // En otra pista, a la misma hora, sí.
  await club.reservar("pista-3", `${dia}T12:00`, 120);
  await club.reservar("pista-3", `${dia}T15:00`, 60);
}));

test("C4 · tampoco puede solaparse con las reservas de 90 minutos que ya existían", OPCIONES, (t) => conApi(t, SEMILLA, async (api) => {
  const club = await crearClub(api, SEMILLA);
  const dia = "2026-11-19";
  // Las reservas de la semilla del jueves 19, que no se pueden tocar.
  assert.deepEqual(await ocupacion(api, dia, "pista-1"), ["12:00-13:30", "18:00-19:30", "19:30-21:00"]);
  assert.deepEqual(await ocupacion(api, dia, "pista-2"), ["10:30-12:00", "15:00-16:30", "18:00-19:30"]);
  assert.deepEqual(await ocupacion(api, dia, "pista-3"), ["09:00-10:30"]);
  const antes = { "pista-1": await ids(api, dia, "pista-1"), "pista-2": await ids(api, dia, "pista-2"), "pista-3": await ids(api, dia, "pista-3") };
  const casos: [string, string, number | undefined][] = [
    ["pista-1", "11:30", 60], ["pista-1", "13:00", 60], ["pista-1", "12:30", 60], ["pista-1", "12:00", 60],
    ["pista-1", "11:00", 90], ["pista-1", "12:30", 90], ["pista-1", "11:00", 120], ["pista-1", "12:00", 120],
    ["pista-1", "17:30", 60], ["pista-1", "19:00", 60], ["pista-1", "16:30", 120], ["pista-1", "18:30", 120],
    ["pista-1", "20:30", 120], ["pista-1", "20:00", undefined], ["pista-1", "17:30", undefined], ["pista-1", "18:00", 90],
    ["pista-2", "11:00", 60], ["pista-2", "09:30", 90], ["pista-2", "14:30", 60], ["pista-2", "16:00", 120], ["pista-2", "17:00", 120],
    ["pista-3", "10:00", 60], ["pista-3", "09:30", 120], ["pista-3", "09:00", 60],
  ];
  for (const [pistaId, hora, duracion] of casos) await club.seSolapa(pistaId, `${dia}T${hora}`, duracion);
  for (const [pistaId, suyas] of Object.entries(antes)) assert.deepEqual(await ids(api, dia, pistaId), suyas, `los intentos no han creado nada en la ${pistaId}`);
}));

test("C4 · que una reserva termine justo cuando empieza otra no es solaparse, con las nuevas y con las que ya existían", OPCIONES, (t) => conApi(t, SEMILLA, async (api) => {
  const club = await crearClub(api, SEMILLA);
  // Jueves 19: pegadas a las reservas de la semilla (pista 1: 12:00-13:30, 18:00-19:30 y 19:30-21:00; pista 3: 09:00-10:30).
  await club.reservar("pista-1", "2026-11-19T10:00", 120); // termina a las 12:00
  await club.reservar("pista-1", "2026-11-19T13:30", 60); // empieza a las 13:30
  await club.reservar("pista-1", "2026-11-19T17:00", 60); // termina a las 18:00
  await club.reservar("pista-1", "2026-11-19T21:00", 60); // empieza a las 21:00
  await club.reservar("pista-3", "2026-11-19T10:30", 60); // empieza a las 10:30
  // Viernes 20, pista 1 (libre en la semilla): pegadas a otras reservas nuevas, por los dos lados.
  assert.deepEqual(await ocupacion(api, "2026-11-20", "pista-1"), []);
  await club.reservar("pista-1", "2026-11-20T12:00", 60); // 12:00-13:00
  await club.reservar("pista-1", "2026-11-20T13:00", 120); // 13:00-15:00
  await club.reservar("pista-1", "2026-11-20T10:30", 90); // 10:30-12:00
  await club.reservar("pista-1", "2026-11-20T15:00", 60); // 15:00-16:00
  await club.reservar("pista-1", "2026-11-20T09:00", undefined); // 09:00-10:30
}));

test("C4 · las reservas canceladas no ocupan la pista", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  const club = await crearClub(api, LUNES);
  const dia = "2027-02-03";
  const cancelada = await club.reservar("pista-1", `${dia}T12:00`, 120); // 12:00-14:00
  await cancelar(api, cancelada.id);
  await club.reservar("pista-1", `${dia}T12:30`, 60); // dentro de la cancelada
  await club.reservar("pista-1", `${dia}T13:30`, 90); // empieza dentro de la cancelada
  const otra = await club.reservar("pista-2", `${dia}T18:00`, 60);
  await cancelar(api, otra.id);
  await club.reservar("pista-2", `${dia}T17:30`, 120); // la cubre entera
}));

test("C4 · las reservas que ya existían, una vez canceladas, tampoco ocupan la pista", OPCIONES, (t) => conApi(t, SEMILLA, async (api) => {
  const club = await crearClub(api, SEMILLA);
  // Sábado 21, pista 1: la semilla tiene 15:00-16:30 (R-0516), 16:30-18:00 y 21:00-22:30.
  assert.deepEqual(await ocupacion(api, "2026-11-21", "pista-1"), ["15:00-16:30", "16:30-18:00", "21:00-22:30"]);
  const r = (await listarTodas(api, "fecha=2026-11-21&pista=pista-1&estado=confirmada")).find((x) => x.inicio === "2026-11-21T15:00")!;
  await cancelar(api, r.id); // faltan más de 24 horas: se cancela gratis
  await club.reservar("pista-1", "2026-11-21T15:30", 60); // 15:30-16:30, dentro de la cancelada
  await club.reservar("pista-1", "2026-11-21T14:00", 90); // 14:00-15:30, empieza antes y termina dentro
}));
