// Tests ocultos de la spec `duraciones`: el campo duracion (C1), el fin de la reserva (C3) y la duración en todas las
// reservas, también en las que ya existían (C7). Caja negra: solo la API HTTP, con /_estado (socios) y /_reloj para
// preparar. Cada prueba arranca su propia API, con la hora de Madrid (la del club).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test, type TestContext } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

/** Si la API se cuelga, el test falla a los 30 segundos y la API se cierra. */
const OPCIONES = { timeout: 30_000 };
/** Lunes 1 de febrero de 2027: toda la semana siguiente está libre (la semilla acaba el 24 de noviembre de 2026). */
const LUNES = "2027-02-01T10:00";
/** Miércoles 3 de febrero de 2027. */
const MIERCOLES = "2027-02-03";
/**
 * Las reservas de la semilla en la base, ordenadas por id y solo con los campos que tenían antes de las duraciones
 * (id, socioId, pistaId, inicio, fin, estado, importe y notas): cuántas son y la huella de su JSON con las claves ordenadas.
 */
const SEMILLA_BASE = { total: 525, huella: "f3fad6261cd9763a" };
const CAMPOS_DE_ANTES = ["id", "socioId", "pistaId", "inicio", "fin", "estado", "importe", "notas"];

interface Reserva {
  id: string;
  socioId: string;
  pistaId: string;
  inicio: string;
  fin: string;
  duracion?: unknown;
  estado: string;
  importe: number;
}

async function conApi(t: TestContext, ahora: string | null, prueba: (api: Api) => Promise<void>): Promise<void> {
  const api = await arrancarApi({ TZ: "Europe/Madrid", ...(ahora ? { AHORA: ahora } : {}) });
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
    const r = await api.pedir("GET", `/api/reservas?${consulta}${consulta ? "&" : ""}limite=100&pagina=${pagina}`);
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
  const conSitio = () => {
    const socioId = [...sitio].find(([, n]) => n > 0)?.[0];
    assert.ok(socioId, "no queda ningún socio con sitio para reservar");
    return socioId;
  };
  const club = {
    /** Intenta crear la reserva con un socio con sitio. `extra` va tal cual en el cuerpo (por ejemplo, duracion). */
    async intentar(pistaId: string, inicio: string, extra: Record<string, unknown> = {}): Promise<Respuesta> {
      const socioId = conSitio();
      const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio, ...extra } });
      if (r.status === 201) sitio.set(socioId, sitio.get(socioId)! - 1);
      return r;
    },
    /** Crea la reserva (sin duracion si es undefined) y comprueba que responde 201. */
    async reservar(pistaId: string, inicio: string, duracion?: number): Promise<Reserva> {
      const r = await club.intentar(pistaId, inicio, duracion === undefined ? {} : { duracion });
      assert.equal(r.status, 201, `${pistaId} ${inicio} ${duracion ?? "sin duracion"}: ${r.status} ${r.texto.slice(0, 300)}`);
      return r.cuerpo.reserva;
    },
  };
  return club;
}

async function consultar(api: Api, id: string): Promise<Reserva> {
  const r = await api.pedir("GET", `/api/reservas/${id}`);
  assert.equal(r.status, 200, `GET /api/reservas/${id}: ${r.texto.slice(0, 300)}`);
  return r.cuerpo.reserva;
}

function sumarMinutos(fechaHora: string, minutos: number): string {
  return new Date(Date.parse(`${fechaHora}:00Z`) + minutos * 60_000).toISOString().slice(0, 16);
}

function esError(r: Respuesta, http: number, codigo: string, caso: string) {
  assert.equal(r.status, http, `${caso}: esperaba ${http} ${codigo} y llegó ${r.status}: ${r.texto.slice(0, 300)}`);
  assert.equal(r.cuerpo?.error?.codigo, codigo, `${caso}: ${r.texto.slice(0, 300)}`);
}

/** El JSON con las claves ordenadas: el orden de las claves de un objeto no cambia la respuesta. */
function canonico(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(canonico);
  if (valor !== null && typeof valor === "object") {
    return Object.fromEntries(Object.keys(valor).sort().map((k) => [k, canonico((valor as Record<string, unknown>)[k])]));
  }
  return valor;
}

function huella(valor: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonico(valor))).digest("hex").slice(0, 16);
}

// --- C1 · Duración ------------------------------------------------------------------------------------------------

test("C1 · sin duracion, la reserva es de 90 minutos", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  const club = await crearClub(api, LUNES);
  for (const [pistaId, hora] of [["pista-1", "10:00"], ["pista-2", "10:30"], ["pista-3", "17:30"]] as const) {
    const reserva = await club.reservar(pistaId, `${MIERCOLES}T${hora}`);
    assert.equal(reserva.duracion, 90, `${pistaId} a las ${hora}, al crearla: ${JSON.stringify(reserva)}`);
    assert.equal((await consultar(api, reserva.id)).duracion, 90, `${pistaId} a las ${hora}, al consultarla`);
  }
}));

test("C1 · duracion acepta 60, 90 y 120 minutos", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  const club = await crearClub(api, LUNES);
  const casos = [["pista-1", "09:00", 60], ["pista-2", "09:30", 90], ["pista-3", "10:00", 120], ["pista-1", "18:00", 120], ["pista-2", "19:30", 60], ["pista-3", "16:30", 90]] as const;
  for (const [pistaId, hora, duracion] of casos) {
    const reserva = await club.reservar(pistaId, `${MIERCOLES}T${hora}`, duracion);
    assert.equal(reserva.duracion, duracion, `${pistaId} a las ${hora} con ${duracion}, al crearla: ${JSON.stringify(reserva)}`);
    assert.equal((await consultar(api, reserva.id)).duracion, duracion, `${pistaId} a las ${hora} con ${duracion}, al consultarla`);
  }
}));

test("C1 · cualquier otro valor de duracion responde 400 DURACION_INVALIDA y no crea la reserva", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  const club = await crearClub(api, LUNES);
  // A las 10:00 todas terminan antes de las 22:30: lo único que falla es la duración.
  const invalidas = [0, 30, 45, 59, 61, 75, 89, 91, 100, 119, 121, 150, 180, -60, 60.5, 90.5];
  for (const duracion of invalidas) {
    esError(await club.intentar("pista-1", `${MIERCOLES}T10:00`, { duracion }), 400, "DURACION_INVALIDA", `duracion ${duracion}`);
  }
  const delDia = await api.pedir("GET", `/api/reservas?fecha=${MIERCOLES}`);
  assert.equal(delDia.cuerpo.total, 0, `no se ha creado ninguna reserva: ${delDia.texto.slice(0, 300)}`);
  await club.reservar("pista-1", `${MIERCOLES}T10:00`, 60);
}));

// --- C3 · Fin ------------------------------------------------------------------------------------------------------

test("C3 · fin es inicio más la duración, al crearla, al consultarla y en el listado", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  const club = await crearClub(api, LUNES);
  const casos: [string, string, number | undefined, string][] = [
    ["pista-1", "09:00", 60, "10:00"],
    ["pista-1", "10:30", 120, "12:30"],
    ["pista-1", "13:00", 90, "14:30"],
    ["pista-1", "20:30", 120, "22:30"],
    ["pista-2", "09:30", 90, "11:00"],
    ["pista-2", "12:00", 60, "13:00"],
    ["pista-2", "17:30", 120, "19:30"],
    ["pista-2", "21:30", 60, "22:30"],
    ["pista-3", "11:00", undefined, "12:30"],
    ["pista-3", "15:30", 60, "16:30"],
    ["pista-3", "21:00", 90, "22:30"],
  ];
  const creadas = new Map<string, string>();
  for (const [pistaId, hora, duracion, fin] of casos) {
    const caso = `${pistaId} a las ${hora} con ${duracion ?? "la duración por defecto"}`;
    const reserva = await club.reservar(pistaId, `${MIERCOLES}T${hora}`, duracion);
    assert.equal(reserva.fin, `${MIERCOLES}T${fin}`, `${caso}, al crearla`);
    assert.equal((await consultar(api, reserva.id)).fin, `${MIERCOLES}T${fin}`, `${caso}, al consultarla`);
    creadas.set(reserva.id, `${MIERCOLES}T${fin}`);
  }
  const listadas = await listarTodas(api, `fecha=${MIERCOLES}`);
  for (const [id, fin] of creadas) assert.equal(listadas.find((r) => r.id === id)?.fin, fin, `${id} en GET /api/reservas`);
}));

test("C3 · las reservas que ya existían siguen terminando 90 minutos después de empezar", OPCIONES, (t) => conApi(t, null, async (api) => {
  const todas = await listarTodas(api, "");
  assert.equal(todas.length, SEMILLA_BASE.total);
  for (const r of todas) assert.equal(r.fin, sumarMinutos(r.inicio, 90), `${r.id}`);
}));

// --- C7 · Duración en todas las reservas -------------------------------------------------------------------------------

test("C7 · las reservas que ya existían devuelven duracion: 90, en el listado y en el detalle", OPCIONES, (t) => conApi(t, null, async (api) => {
  const todas = await listarTodas(api, "");
  assert.equal(todas.length, SEMILLA_BASE.total, "la semilla trae 525 reservas");
  for (const r of todas) assert.equal(r.duracion, 90, `${r.id} en GET /api/reservas: ${JSON.stringify(r)}`);
  for (const estado of ["confirmada", "cancelada", "no_presentada"]) {
    const filtradas = await listarTodas(api, `estado=${estado}`);
    assert.ok(filtradas.length > 0, `la semilla trae reservas en estado ${estado}`);
    for (const r of filtradas) assert.equal(r.duracion, 90, `${r.id} en GET /api/reservas?estado=${estado}`);
    for (const r of [filtradas[0]!, filtradas.at(-1)!]) assert.equal((await consultar(api, r.id)).duracion, 90, `GET /api/reservas/${r.id}`);
  }
}));

test("C7 · las reservas que ya existían se devuelven igual que en la base, con la duración de más", OPCIONES, (t) => conApi(t, null, async (api) => {
  const todas = await listarTodas(api, "");
  const deAntes = todas
    .map((r) => Object.fromEntries(CAMPOS_DE_ANTES.map((campo) => [campo, (r as unknown as Record<string, unknown>)[campo]])))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  assert.equal(deAntes.length, SEMILLA_BASE.total);
  assert.equal(huella(deAntes), SEMILLA_BASE.huella, "las reservas de la semilla han cambiado");
}));

test("C7 · las reservas nuevas devuelven su duracion al crearlas, al consultarlas, en el listado y al cancelarlas", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  const club = await crearClub(api, LUNES);
  const creadas: [Reserva, number][] = [];
  for (const [pistaId, hora, duracion] of [["pista-1", "11:00", 60], ["pista-2", "12:30", 120], ["pista-3", "15:30", undefined]] as const) {
    const reserva = await club.reservar(pistaId, `${MIERCOLES}T${hora}`, duracion);
    creadas.push([reserva, duracion ?? 90]);
    assert.equal(reserva.duracion, duracion ?? 90, `${pistaId} a las ${hora}, al crearla`);
  }
  const listadas = await listarTodas(api, `fecha=${MIERCOLES}`);
  for (const [reserva, duracion] of creadas) {
    assert.equal((await consultar(api, reserva.id)).duracion, duracion, `${reserva.id}, al consultarla`);
    assert.equal(listadas.find((r) => r.id === reserva.id)?.duracion, duracion, `${reserva.id} en GET /api/reservas`);
    const cancelada = await api.pedir("POST", `/api/reservas/${reserva.id}/cancelar`, { cuerpo: {} });
    assert.equal(cancelada.status, 200, cancelada.texto.slice(0, 300));
    assert.equal(cancelada.cuerpo.reserva.duracion, duracion, `${reserva.id}, al cancelarla`);
  }
}));

test("C7 · al cancelar una reserva que ya existía, la respuesta trae duracion: 90", OPCIONES, (t) => conApi(t, null, async (api) => {
  // R-0525: jueves 19 a las 12:00 (faltan 26 horas, se cancela gratis). R-0520: jueves 19 a las 09:00 (faltan 23 horas).
  const gratis = await api.pedir("POST", "/api/reservas/R-0525/cancelar", { cuerpo: {} });
  assert.equal(gratis.status, 200, gratis.texto.slice(0, 300));
  assert.equal(gratis.cuerpo.reserva.duracion, 90, gratis.texto.slice(0, 300));
  const forzada = await api.pedir("POST", "/api/reservas/R-0520/cancelar", { cuerpo: { forzar: true } });
  assert.equal(forzada.status, 200, forzada.texto.slice(0, 300));
  assert.equal(forzada.cuerpo.reserva.duracion, 90, forzada.texto.slice(0, 300));
}));
