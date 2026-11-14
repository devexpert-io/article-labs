// Tests ocultos de la spec `duraciones`: franjas ocupadas (C8) y huecos (C9) en GET /api/disponibilidad.
// Caja negra: solo la API HTTP, con /_estado (socios) y /_reloj para preparar. Cada prueba arranca su propia API, con la
// hora de Madrid (la del club). Los huecos valen con inicio y fin como AAAA-MM-DDTHH:MM (del día pedido) o como HH:MM, y
// con campos de más: la spec solo dice que cada uno trae inicio y fin.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test, type TestContext } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

/** Si la API se cuelga, el test falla a los 30 segundos y la API se cierra. */
const OPCIONES = { timeout: 30_000 };
/** Lunes 1 de febrero de 2027: toda la semana siguiente está libre (la semilla acaba el 24 de noviembre de 2026). */
const LUNES = "2027-02-01T10:00";
/** La hora de la semilla (sin AHORA): miércoles 18 de noviembre de 2026 a las 10:00. */
const SEMILLA = "2026-11-18T10:00";
const HORAS = ["09:00", "10:30", "12:00", "13:30", "15:00", "16:30", "18:00", "19:30", "21:00"];
const PISTAS = ["pista-1", "pista-2", "pista-3", "pista-4"];

/**
 * Las franjas de la base con su semilla: la huella de lo que devolvía GET /api/disponibilidad de cada pista (pistaId,
 * nombre, cubierta, estado y franjas con inicio, fin, estado y precio), sin los huecos. Días con reservas confirmadas y
 * canceladas, pero sin no presentadas (la spec no dice nada de ellas), y días sin reservas.
 */
const FRANJAS_BASE: { consulta: string; huella: string }[] = [
  { consulta: "fecha=2026-10-01", huella: "3270eb002018fdb6" },
  { consulta: "fecha=2026-10-10", huella: "880f8dbfe7669fed" },
  { consulta: "fecha=2026-10-25", huella: "5a1099b22f328d55" },
  { consulta: "fecha=2026-11-07", huella: "fffdf2e9ae4ba552" },
  { consulta: "fecha=2026-11-09", huella: "c9922a2da3f657ad" },
  { consulta: "fecha=2026-11-16", huella: "00dc2394abff36c8" },
  { consulta: "fecha=2026-11-18", huella: "775820db3b420768" },
  { consulta: "fecha=2026-11-19", huella: "258e3b01e5dfce2f" },
  { consulta: "fecha=2026-11-20", huella: "e13b6879696bd7db" },
  { consulta: "fecha=2026-11-21", huella: "8dbbe0839b0b5a51" },
  { consulta: "fecha=2026-11-22", huella: "3eba461d34e12e40" },
  { consulta: "fecha=2026-11-23", huella: "1b943536a207898c" },
  { consulta: "fecha=2026-11-24", huella: "a7b08d14c221b3d3" },
  { consulta: "fecha=2026-11-25", huella: "1881e9af33f6bf58" },
  { consulta: "fecha=2027-02-03", huella: "fad534083c7eccef" },
  { consulta: "fecha=2026-11-19&pista=pista-1", huella: "0f141673b5d75f93" },
  { consulta: "fecha=2026-11-21&pista=pista-4", huella: "b0d6590907d7ed88" },
];

interface Reserva {
  id: string;
  socioId: string;
  pistaId: string;
  inicio: string;
  fin: string;
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
  return {
    /** Crea la reserva (sin duracion si es undefined) y comprueba que responde 201. */
    async reservar(pistaId: string, inicio: string, duracion?: number): Promise<Reserva> {
      const socioId = [...sitio].find(([, n]) => n > 0)?.[0];
      assert.ok(socioId, "no queda ningún socio con sitio para reservar");
      const cuerpo = { socioId, pistaId, inicio, ...(duracion === undefined ? {} : { duracion }) };
      const r = await api.pedir("POST", "/api/reservas", { cuerpo });
      assert.equal(r.status, 201, `${JSON.stringify(cuerpo)}: ${r.status} ${r.texto.slice(0, 300)}`);
      sitio.set(socioId, sitio.get(socioId)! - 1);
      return r.cuerpo.reserva;
    },
  };
}

async function cancelar(api: Api, id: string) {
  const r = await api.pedir("POST", `/api/reservas/${id}/cancelar`, { cuerpo: {} });
  assert.equal(r.status, 200, `cancelar ${id}: ${r.texto.slice(0, 300)}`);
}

async function reloj(api: Api, ahora: string) {
  const r = await api.pedir("POST", "/_reloj", { cuerpo: { ahora } });
  assert.equal(r.status, 200, `mover el reloj a ${ahora}: ${r.texto}`);
}

async function disponibilidad(api: Api, consulta: string): Promise<any> {
  const r: Respuesta = await api.pedir("GET", `/api/disponibilidad?${consulta}`);
  assert.equal(r.status, 200, `GET /api/disponibilidad?${consulta}: ${r.texto.slice(0, 300)}`);
  assert.ok(Array.isArray(r.cuerpo?.pistas), `GET /api/disponibilidad?${consulta}: ${r.texto.slice(0, 300)}`);
  return r.cuerpo;
}

function pistaDe(cuerpo: any, pistaId: string): any {
  const pista = cuerpo.pistas.find((p: { pistaId: string }) => p.pistaId === pistaId);
  assert.ok(pista, `la disponibilidad no trae la ${pistaId}`);
  return pista;
}

/** El estado de las nueve franjas de una pista, en orden, con una letra: L (libre), R (reservada) o C (cerrada). */
function estados(cuerpo: any, pistaId: string): string {
  const franjas = [...pistaDe(cuerpo, pistaId).franjas].sort((a: any, b: any) => a.inicio.localeCompare(b.inicio));
  return franjas.map((f: any) => ({ libre: "L", reservada: "R", cerrada: "C" })[f.estado as string] ?? "?").join("");
}

/** Una hora de un hueco como HH:MM: vale AAAA-MM-DDTHH:MM del día pedido o HH:MM. */
function hora(valor: unknown, fecha: string): string {
  if (typeof valor === "string" && /^\d{2}:\d{2}$/.test(valor)) return valor;
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valor) && valor.startsWith(`${fecha}T`)) return valor.slice(11);
  return `¿${JSON.stringify(valor)}?`;
}

/** Los huecos de una pista como "HH:MM-HH:MM", en el orden en que vienen. */
function huecos(cuerpo: any, pistaId: string, fecha: string): string[] {
  const pista = pistaDe(cuerpo, pistaId);
  assert.ok(Array.isArray(pista.huecos), `la ${pistaId} no trae huecos: ${JSON.stringify(pista).slice(0, 300)}`);
  return pista.huecos.map((h: any) => `${hora(h?.inicio, fecha)}-${hora(h?.fin, fecha)}`);
}

/** Los huecos que debería tener una pista operativa con esas reservas confirmadas del día (todas de 09:00 a 22:30). */
function huecosEsperados(reservas: { inicio: string; fin: string }[]): string[] {
  const libres: string[] = [];
  let desde = "09:00";
  for (const r of [...reservas].sort((a, b) => a.inicio.localeCompare(b.inicio))) {
    const [inicio, fin] = [r.inicio.slice(11), r.fin.slice(11)];
    if (inicio > desde) libres.push(`${desde}-${inicio}`);
    if (fin > desde) desde = fin;
  }
  if (desde < "22:30") libres.push(`${desde}-22:30`);
  return libres;
}

/** Lo que la base devuelve de cada pista (sin huecos), con las claves y el orden normalizados. */
function loDeLaBase(cuerpo: any) {
  return [...cuerpo.pistas]
    .sort((a: any, b: any) => a.pistaId.localeCompare(b.pistaId))
    .map((p: any) => ({
      pistaId: p.pistaId,
      nombre: p.nombre,
      cubierta: p.cubierta,
      estado: p.estado,
      franjas: [...p.franjas]
        .sort((a: any, b: any) => a.inicio.localeCompare(b.inicio))
        .map((f: any) => ({ inicio: f.inicio, fin: f.fin, estado: f.estado, precio: f.precio })),
    }));
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

function sumarMinutos(fechaHora: string, minutos: number): string {
  return new Date(Date.parse(`${fechaHora}:00Z`) + minutos * 60_000).toISOString().slice(0, 16);
}

// --- C8 · Franjas ocupadas -------------------------------------------------------------------------------------------

test("C8 · con la semilla, GET /api/disponibilidad sigue devolviendo las mismas franjas de 90 minutos que la base", OPCIONES, (t) => conApi(t, SEMILLA, async (api) => {
  for (const { consulta, huella: deLaBase } of FRANJAS_BASE) {
    const cuerpo = await disponibilidad(api, consulta);
    assert.equal(huella(loDeLaBase(cuerpo)), deLaBase, `${consulta}: las franjas no son las de la base: ${JSON.stringify(loDeLaBase(cuerpo)).slice(0, 300)}`);
  }
}));

test("C8 · una franja está reservada si cualquier reserva confirmada de la pista se solapa con ella, aunque sea en parte", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  const club = await crearClub(api, LUNES);
  const fecha = "2027-02-03";
  const pista1 = [["11:00", 60], ["13:00", 120], ["17:30", 60], ["21:30", 60]] as const; // ninguna se toca con otra
  for (const [hora, duracion] of pista1) await club.reservar("pista-1", `${fecha}T${hora}`, duracion);
  const pista2 = [["09:30", 120], ["15:30", 60], ["19:30", undefined]] as const;
  for (const [hora, duracion] of pista2) await club.reservar("pista-2", `${fecha}T${hora}`, duracion);

  const cuerpo = await disponibilidad(api, `fecha=${fecha}`);
  //                                     09:00 10:30 12:00 13:30 15:00 16:30 18:00 19:30 21:00
  assert.equal(estados(cuerpo, "pista-1"), "LRRRLRRLR", "pista 1: 11:00-12:00, 13:00-15:00, 17:30-18:30 y 21:30-22:30");
  assert.equal(estados(cuerpo, "pista-2"), "RRLLRLLRL", "pista 2: 09:30-11:30, 15:30-16:30 y 19:30-21:00");
  assert.equal(estados(cuerpo, "pista-3"), "LLLLLLLLL", "pista 3: sin reservas");
  assert.equal(estados(cuerpo, "pista-4"), "CCCCCCCCC", "pista 4: cerrada");
  // Siguen siendo las nueve franjas de siempre, con su precio de siempre (miércoles: punta desde las 18:00).
  const precios = new Map((await api.pedir("GET", "/api/pistas")).cuerpo.pistas.map((p: any) => [p.id, p]));
  for (const pistaId of PISTAS) {
    const franjas = [...pistaDe(cuerpo, pistaId).franjas].sort((a: any, b: any) => a.inicio.localeCompare(b.inicio));
    const p: any = precios.get(pistaId);
    const esperadas = HORAS.map((h) => ({ inicio: `${fecha}T${h}`, fin: sumarMinutos(`${fecha}T${h}`, 90), precio: h >= "18:00" ? p.precioPunta : p.precioValle }));
    assert.deepEqual(franjas.map((f: any) => ({ inicio: f.inicio, fin: f.fin, precio: f.precio })), esperadas, `las franjas de la ${pistaId}`);
  }
  // Con el filtro de pista, lo mismo.
  assert.equal(estados(await disponibilidad(api, `fecha=${fecha}&pista=pista-1`), "pista-1"), "LRRRLRRLR", "pista 1 con ?pista=");
}));

test("C8 · al cancelar una reserva, las franjas con las que se solapaba vuelven a estar libres", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  const club = await crearClub(api, LUNES);
  const fecha = "2027-02-03";
  const tarde = await club.reservar("pista-1", `${fecha}T17:30`, 60); // 17:30-18:30: pisa las franjas de 16:30 y 18:00
  const manana = await club.reservar("pista-3", `${fecha}T10:00`, 120); // 10:00-12:00: pisa las de 09:00 y 10:30
  await club.reservar("pista-1", `${fecha}T12:30`, 60); // 12:30-13:30: pisa la de 12:00 y no se cancela
  let cuerpo = await disponibilidad(api, `fecha=${fecha}`);
  assert.equal(estados(cuerpo, "pista-1"), "LLRLLRRLL");
  assert.equal(estados(cuerpo, "pista-3"), "RRLLLLLLL");
  await cancelar(api, tarde.id);
  await cancelar(api, manana.id);
  cuerpo = await disponibilidad(api, `fecha=${fecha}`);
  assert.equal(estados(cuerpo, "pista-1"), "LLRLLLLLL", "pista 1 después de cancelar la de las 17:30");
  assert.equal(estados(cuerpo, "pista-3"), "LLLLLLLLL", "pista 3 después de cancelar la de las 10:00");
}));

// --- C9 · Huecos ---------------------------------------------------------------------------------------------------

test("C9 · un día sin reservas, cada pista operativa tiene un único hueco de 09:00 a 22:30 y la cerrada no tiene ninguno", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  for (const fecha of ["2027-02-03", "2027-02-06"]) {
    const cuerpo = await disponibilidad(api, `fecha=${fecha}`);
    for (const pistaId of ["pista-1", "pista-2", "pista-3"]) assert.deepEqual(huecos(cuerpo, pistaId, fecha), ["09:00-22:30"], `${pistaId} el ${fecha}`);
    assert.deepEqual(huecos(cuerpo, "pista-4", fecha), [], `pista-4 (cerrada) el ${fecha}`);
  }
  const sola = await disponibilidad(api, "fecha=2027-02-03&pista=pista-2");
  assert.deepEqual(huecos(sola, "pista-2", "2027-02-03"), ["09:00-22:30"], "con ?pista=pista-2");
}));

test("C9 · los huecos son los intervalos libres más largos posibles entre las reservas confirmadas, ordenados por hora", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  const club = await crearClub(api, LUNES);
  const fecha = "2027-02-04";
  // Pista 1: 09:30-10:30, 12:00-14:00, 17:30-19:00 y 21:30-22:30, creadas en desorden.
  for (const [hora, duracion] of [["17:30", 90], ["09:30", 60], ["21:30", 60], ["12:00", 120]] as const) {
    await club.reservar("pista-1", `${fecha}T${hora}`, duracion);
  }
  // Pista 2: 09:00-11:00 y 20:30-22:30.
  await club.reservar("pista-2", `${fecha}T20:30`, 120);
  await club.reservar("pista-2", `${fecha}T09:00`, 120);
  // Pista 3: una cancelada (13:00-14:00) y una de 15:30 sin duracion (15:30-17:00).
  const cancelada = await club.reservar("pista-3", `${fecha}T13:00`, 60);
  await cancelar(api, cancelada.id);
  await club.reservar("pista-3", `${fecha}T15:30`);

  const cuerpo = await disponibilidad(api, `fecha=${fecha}`);
  assert.deepEqual(huecos(cuerpo, "pista-1", fecha), ["09:00-09:30", "10:30-12:00", "14:00-17:30", "19:00-21:30"], "pista 1");
  assert.deepEqual(huecos(cuerpo, "pista-2", fecha), ["11:00-20:30"], "pista 2");
  assert.deepEqual(huecos(cuerpo, "pista-3", fecha), ["09:00-15:30", "17:00-22:30"], "pista 3: la cancelada no cuenta");
  assert.deepEqual(huecos(cuerpo, "pista-4", fecha), [], "pista 4: cerrada");
  for (const pistaId of ["pista-1", "pista-2", "pista-3"]) {
    const sola = await disponibilidad(api, `fecha=${fecha}&pista=${pistaId}`);
    assert.deepEqual(huecos(sola, pistaId, fecha), huecos(cuerpo, pistaId, fecha), `${pistaId} con ?pista=`);
  }
  // Los demás días no cambian.
  assert.deepEqual(huecos(await disponibilidad(api, "fecha=2027-02-05"), "pista-1", "2027-02-05"), ["09:00-22:30"], "el día siguiente");
}));

test("C9 · los huecos tienen en cuenta las reservas que ya existían, también las que van seguidas", OPCIONES, (t) => conApi(t, SEMILLA, async (api) => {
  const estadoPistas = new Map((await api.pedir("GET", "/api/pistas")).cuerpo.pistas.map((p: any) => [p.id, p.estado]));
  for (let dia = 18; dia <= 24; dia++) {
    const fecha = `2026-11-${dia}`;
    const confirmadas = await listarTodas(api, `fecha=${fecha}&estado=confirmada`);
    const cuerpo = await disponibilidad(api, `fecha=${fecha}`);
    for (const pistaId of PISTAS) {
      const esperados = estadoPistas.get(pistaId) === "cerrada" ? [] : huecosEsperados(confirmadas.filter((r) => r.pistaId === pistaId));
      assert.deepEqual(huecos(cuerpo, pistaId, fecha), esperados, `${pistaId} el ${fecha}`);
    }
  }
  // Algunos, a mano: el jueves 19 en la pista 2 y el domingo 22 en la pista 2, con cinco reservas de la semilla seguidas.
  assert.deepEqual(huecos(await disponibilidad(api, "fecha=2026-11-19"), "pista-2", "2026-11-19"), ["09:00-10:30", "12:00-15:00", "16:30-18:00", "19:30-22:30"]);
  assert.deepEqual(huecos(await disponibilidad(api, "fecha=2026-11-22"), "pista-2", "2026-11-22"), ["09:00-10:30", "12:00-15:00", "21:00-22:30"]);
  assert.deepEqual(huecos(await disponibilidad(api, "fecha=2026-11-21"), "pista-1", "2026-11-21"), ["09:00-15:00", "18:00-21:00"]);
}));

test("C9 · los huecos no tienen en cuenta la hora actual", OPCIONES, (t) => conApi(t, SEMILLA, async (api) => {
  // Hoy (miércoles 18) a las 10:00: los huecos empiezan a las 09:00, aunque esa hora ya haya pasado.
  let cuerpo = await disponibilidad(api, "fecha=2026-11-18");
  assert.deepEqual(huecos(cuerpo, "pista-1", "2026-11-18"), ["09:00-16:30", "19:30-22:30"], "pista 1 hoy");
  assert.deepEqual(huecos(cuerpo, "pista-2", "2026-11-18"), ["09:00-22:30"], "pista 2 hoy");
  const club = await crearClub(api, SEMILLA);
  await club.reservar("pista-3", "2026-11-25T12:00", 60);
  await club.reservar("pista-3", "2026-11-25T18:00", 120);
  const esperados = ["09:00-12:00", "13:00-18:00", "20:00-22:30"];
  for (const ahora of ["2026-11-18T10:00", "2026-11-25T08:00", "2026-11-25T12:30", "2026-11-25T19:00", "2026-11-25T23:00", "2026-12-10T10:00"]) {
    await reloj(api, ahora);
    cuerpo = await disponibilidad(api, "fecha=2026-11-25");
    assert.deepEqual(huecos(cuerpo, "pista-3", "2026-11-25"), esperados, `pista 3 el 25 con el reloj a ${ahora}`);
    assert.deepEqual(huecos(cuerpo, "pista-2", "2026-11-25"), ["09:00-22:30"], `pista 2 el 25 con el reloj a ${ahora}`);
  }
}));

test("C9 · una pista cerrada no tiene huecos, y si se abre vuelve a tenerlos", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  const club = await crearClub(api, LUNES);
  const fecha = "2027-02-03";
  await club.reservar("pista-1", `${fecha}T12:00`, 60);
  const cerrar = await api.pedir("PATCH", "/api/pistas/pista-1", { cuerpo: { estado: "cerrada" } });
  assert.equal(cerrar.status, 200, cerrar.texto.slice(0, 300));
  let cuerpo = await disponibilidad(api, `fecha=${fecha}`);
  assert.deepEqual(huecos(cuerpo, "pista-1", fecha), [], "pista 1 cerrada");
  assert.deepEqual(huecos(cuerpo, "pista-4", fecha), [], "pista 4 cerrada");
  assert.equal(estados(cuerpo, "pista-1"), "CCCCCCCCC");
  assert.deepEqual(huecos(await disponibilidad(api, `fecha=${fecha}&pista=pista-1`), "pista-1", fecha), [], "pista 1 cerrada, con ?pista=");
  assert.deepEqual(huecos(cuerpo, "pista-2", fecha), ["09:00-22:30"], "pista 2, abierta");
  const abrir = await api.pedir("PATCH", "/api/pistas/pista-1", { cuerpo: { estado: "operativa" } });
  assert.equal(abrir.status, 200, abrir.texto.slice(0, 300));
  cuerpo = await disponibilidad(api, `fecha=${fecha}`);
  assert.deepEqual(huecos(cuerpo, "pista-1", fecha), ["09:00-12:00", "13:00-22:30"], "pista 1 abierta otra vez");
}));
