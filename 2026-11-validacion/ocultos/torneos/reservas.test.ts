// Tests ocultos de la spec `torneos`: los partidos no son reservas (C23).
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en test-ocultos/
// dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test. Cada prueba arranca su propia API.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

// ---- Ayudas comunes: son las mismas en todos los ficheros, porque el corrector solo copia ayuda.ts y los *.test.ts ----

const GESTOR = "socio-040";
/** Lunes 4 de enero de 2027 a las 10:00: nadie tiene reservas futuras y las franjas de las pistas operativas están libres. */
const ENERO = "2027-01-04T10:00";
/** Sábado 16 y domingo 17 de enero de 2027: los días de casi todos los torneos de las pruebas (el plazo acaba el jueves 14). */
const SABADO = "2027-01-16";
const DOMINGO = "2027-01-17";
/** Sábado 27 de febrero de 2027: ya han empezado todos los partidos de las pruebas. */
const DESPUES = "2027-02-27T10:00";
/** Los inicios de las franjas del club, como dice el README. */
const HORAS = ["09:00", "10:30", "12:00", "13:30", "15:00", "16:30", "18:00", "19:30", "21:00"];

const abiertas = new Set<Api>();
after(() => abiertas.forEach((api) => api.cerrar()));

/**
 * Cada prueba arranca su propia API, así que no depende del orden ni de lo que cambien las demás. Por defecto, con el reloj
 * del club en ENERO y en UTC, para que la zona horaria del sistema no influya (en enero y febrero no hay cambio de hora).
 */
function prueba(nombre: string, cuerpo: (api: Api) => Promise<void>, entorno: Record<string, string> = {}) {
  test(nombre, { timeout: 45_000 }, () => conApiNueva(cuerpo, entorno));
}

/** Una API recién arrancada, con la semilla de siempre: para que cada torneo de una prueba tenga sus propios socios si hace falta. */
async function conApiNueva(cuerpo: (api: Api) => Promise<void>, entorno: Record<string, string> = {}) {
  const api = await arrancarApi({ AHORA: ENERO, TZ: "UTC", ...entorno });
  abiertas.add(api);
  try {
    await cuerpo(api);
  } finally {
    api.cerrar();
    abiertas.delete(api);
  }
}

function esError(r: Respuesta, http: number, codigo: string, contexto = "") {
  assert.equal(r.status, http, `${contexto} esperaba ${http} ${codigo} y llegó ${r.status}: ${r.texto.slice(0, 500)}`);
  assert.equal(r.cuerpo?.error?.codigo, codigo, `${contexto} ${r.texto.slice(0, 500)}`);
}

/** Para preparar: cualquier 2xx vale (el código exacto de cada respuesta se prueba en su criterio). */
function esExito(r: Respuesta, contexto = "") {
  assert.ok(r.status >= 200 && r.status < 300, `${contexto} esperaba un 2xx y llegó ${r.status}: ${r.texto.slice(0, 500)}`);
}

async function reloj(api: Api, ahora: string) {
  const r = await api.pedir("POST", "/_reloj", { cuerpo: { ahora } });
  assert.equal(r.status, 200, `mover el reloj a ${ahora}: ${r.texto}`);
}

/** Socios de la semilla con rol socio y la cuota al día, por orden de id (en 2027 ninguno tiene reservas futuras). */
async function sociosAlDia(api: Api, cuantos: number): Promise<string[]> {
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  const ids: string[] = estado.socios.filter((s: any) => s.rol === "socio" && s.cuotaActiva === true).map((s: any) => s.id);
  assert.ok(ids.length >= cuantos, `hacen falta ${cuantos} socios con la cuota al día y hay ${ids.length}`);
  return ids.slice(0, cuantos);
}

/** Socios de la semilla sin la cuota al día. */
async function sociosSinCuota(api: Api): Promise<string[]> {
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  const ids: string[] = estado.socios.filter((s: any) => s.rol === "socio" && s.cuotaActiva === false).map((s: any) => s.id);
  assert.ok(ids.length >= 2, "la semilla tiene socios sin la cuota al día");
  return ids;
}

/** Un id de la API como texto (o null), para comparar sin depender de si la API usa números o textos. */
function id(x: unknown): string | null {
  return x === null || x === undefined ? null : String(x);
}

/** Los ids de inscripción tal como los dio la API, para mandar `ganadora` con el mismo tipo (texto o número). */
const crudos = new Map<string, unknown>();

function ruta(torneoId: unknown, resto = ""): string {
  return `/api/torneos/${encodeURIComponent(String(torneoId))}${resto}`;
}

/** Todas las franjas del club en esos días. */
function franjasDe(...dias: string[]): string[] {
  return dias.flatMap((dia) => HORAS.map((hora) => `${dia}T${hora}`));
}

/** Los datos de un torneo válido (la pista 1 el sábado 16 a las 09:00, 10:30 y 12:00), con los cambios que se pidan. */
function datosTorneo(cambios: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    nombre: "Torneo de invierno",
    pistas: ["pista-1"],
    franjas: [`${SABADO}T09:00`, `${SABADO}T10:30`, `${SABADO}T12:00`],
    plazas: 8,
    cuota: 1500,
    ...cambios,
  };
}

/** Pide crear un torneo como `socio`: el gestor si no se dice y, con null, sin cabecera X-Socio. */
function pedirTorneo(api: Api, cuerpo: Record<string, unknown>, socio: string | null = GESTOR) {
  return api.pedir("POST", "/api/torneos", { cuerpo, socio: socio ?? undefined });
}

/** Crea un torneo como el gestor y devuelve el torneo de la respuesta (el 201 y la forma exacta de la respuesta se prueban en C4). */
async function crearTorneo(api: Api, cambios: Record<string, unknown> = {}): Promise<any> {
  const r = await pedirTorneo(api, datosTorneo(cambios));
  esExito(r, `crear el torneo ${JSON.stringify(cambios)}:`);
  const torneo = r.cuerpo?.torneo ?? r.cuerpo;
  assert.ok(id(torneo?.id) !== null && id(torneo?.id) !== "", `el torneo creado no trae id: ${r.texto}`);
  return torneo;
}

/** GET /api/torneos/:id (que la respuesta sea { torneo } se prueba en C4). */
async function consultar(api: Api, torneoId: unknown): Promise<any> {
  const r = await api.pedir("GET", ruta(torneoId));
  assert.equal(r.status, 200, `GET /api/torneos/${torneoId}: ${r.texto.slice(0, 500)}`);
  return r.cuerpo?.torneo ?? r.cuerpo;
}

/** Los ids de los torneos de GET /api/torneos, en su orden. */
async function idsDelListado(api: Api, consulta = ""): Promise<(string | null)[]> {
  const r = await api.pedir("GET", `/api/torneos${consulta}`);
  assert.equal(r.status, 200, `GET /api/torneos${consulta}: ${r.texto.slice(0, 500)}`);
  const lista = r.cuerpo?.torneos ?? r.cuerpo;
  assert.ok(Array.isArray(lista), `GET /api/torneos${consulta} trae una lista: ${r.texto.slice(0, 500)}`);
  return lista.map((t: any) => id(t?.id));
}

/** Las inscripciones de un torneo como [id, estado], en su orden. */
function inscripcionesDe(torneo: any): [string | null, unknown][] {
  assert.ok(Array.isArray(torneo?.inscripciones), `el torneo trae la lista inscripciones: ${JSON.stringify(torneo)?.slice(0, 500)}`);
  return torneo.inscripciones.map((i: any) => [id(i?.id), i?.estado]);
}

/** Pide inscribir a una pareja como `quien`: el gestor si no se dice y, con null, sin cabecera X-Socio. */
function inscribir(api: Api, torneoId: unknown, socios: unknown, quien: string | null = GESTOR) {
  return api.pedir("POST", ruta(torneoId, "/inscripciones"), { cuerpo: { socios }, socio: quien ?? undefined });
}

/** Inscribe una pareja como el gestor y devuelve el id de su inscripción (el 201 y la forma de la respuesta se prueban en C7). */
async function inscribirPareja(api: Api, torneoId: unknown, socios: string[]): Promise<string> {
  const r = await inscribir(api, torneoId, socios);
  esExito(r, `inscribir a ${socios.join(" y ")}:`);
  const inscripcion = r.cuerpo?.inscripcion ?? r.cuerpo;
  assert.ok(id(inscripcion?.id) !== null, `la inscripción no trae id: ${r.texto}`);
  crudos.set(id(inscripcion.id)!, inscripcion.id);
  return id(inscripcion.id)!;
}

/** Inscribe n parejas con los socios de la lista, de dos en dos, y devuelve los ids de sus inscripciones: la pareja 1 primero. */
async function inscribirParejas(api: Api, torneoId: unknown, socios: string[], n: number): Promise<string[]> {
  assert.ok(socios.length >= 2 * n, `hacen falta ${2 * n} socios para ${n} parejas`);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await inscribirPareja(api, torneoId, [socios[2 * i]!, socios[2 * i + 1]!]));
  return ids;
}

/** Pide dar de baja una inscripción como `quien`: el gestor si no se dice y, con null, sin cabecera X-Socio. */
function darDeBaja(api: Api, torneoId: unknown, inscripcionId: unknown, quien: string | null = GESTOR) {
  const resto = `/inscripciones/${encodeURIComponent(String(inscripcionId))}/baja`;
  return api.pedir("POST", ruta(torneoId, resto), { cuerpo: {}, socio: quien ?? undefined });
}

function cerrar(api: Api, torneoId: unknown, quien: string | null = GESTOR) {
  return api.pedir("POST", ruta(torneoId, "/cerrar"), { cuerpo: {}, socio: quien ?? undefined });
}

/** Cierra el torneo como el gestor y devuelve el torneo de GET /api/torneos/:id. */
async function cerrarYConsultar(api: Api, torneoId: unknown): Promise<any> {
  esExito(await cerrar(api, torneoId), `cerrar el torneo ${torneoId}:`);
  return consultar(api, torneoId);
}

function cancelarTorneo(api: Api, torneoId: unknown, quien: string | null = GESTOR) {
  return api.pedir("POST", ruta(torneoId, "/cancelar"), { cuerpo: {}, socio: quien ?? undefined });
}

/**
 * Pide apuntar un resultado como `quien`: el gestor si no se dice y, con null, sin cabecera X-Socio. Si `ganadora` es el id
 * de una inscripción, se manda con el tipo con el que lo dio la API.
 */
function apuntar(api: Api, torneoId: unknown, partidoId: unknown, cuerpo: Record<string, unknown>, quien: string | null = GESTOR) {
  const resto = `/partidos/${encodeURIComponent(String(partidoId))}/resultado`;
  const g = cuerpo.ganadora;
  const datos = typeof g === "string" && crudos.has(g) ? { ...cuerpo, ganadora: crudos.get(g) } : cuerpo;
  return api.pedir("POST", ruta(torneoId, resto), { cuerpo: datos, socio: quien ?? undefined });
}

/** Apunta un resultado como el gestor, con el reloj ya en la hora del partido o después, y devuelve el partido de la respuesta. */
async function apuntarResultado(api: Api, torneoId: unknown, p: any, ganadora: string | null, marcador?: string): Promise<any> {
  const r = await apuntar(api, torneoId, p.id, marcador === undefined ? { ganadora } : { ganadora, marcador });
  esExito(r, `apuntar el partido ${p.numero} de la ronda ${p.ronda}:`);
  return r.cuerpo?.partido ?? r.cuerpo;
}

/**
 * Un torneo cerrado con n parejas y sitio de sobra: las tres pistas operativas y todas las franjas de los días que se pidan
 * (el sábado 16 y el domingo 17 si no se dice). Devuelve el torneo de GET /api/torneos/:id y los ids de las inscripciones
 * por orden de inscripción: parejas[0] es la pareja 1.
 */
async function torneoCerrado(api: Api, n: number, opciones: { socios?: string[]; dias?: string[] } = {}): Promise<{ torneo: any; parejas: string[] }> {
  const socios = opciones.socios ?? (await sociosAlDia(api, 2 * n));
  const franjas = franjasDe(...(opciones.dias ?? [SABADO, DOMINGO]));
  const t = await crearTorneo(api, { pistas: ["pista-1", "pista-2", "pista-3"], franjas, plazas: 16 });
  const parejas = await inscribirParejas(api, t.id, socios, n);
  return { torneo: await cerrarYConsultar(api, t.id), parejas };
}

/** El partido de una ronda con ese número. */
function partido(torneo: any, ronda: number, numero: number): any {
  assert.ok(Array.isArray(torneo?.partidos), `el torneo trae la lista partidos: ${JSON.stringify(torneo)?.slice(0, 500)}`);
  const p = torneo.partidos.find((x: any) => x?.ronda === ronda && x?.numero === numero);
  assert.ok(p, `falta el partido ${numero} de la ronda ${ronda}: ${JSON.stringify(torneo.partidos).slice(0, 1500)}`);
  return p;
}

/** Los partidos de una ronda, por número. */
function rondaDe(torneo: any, ronda: number): any[] {
  assert.ok(Array.isArray(torneo?.partidos), `el torneo trae la lista partidos: ${JSON.stringify(torneo)?.slice(0, 500)}`);
  return torneo.partidos.filter((p: any) => p?.ronda === ronda).sort((a: any, b: any) => a.numero - b.numero);
}

/** Las parejas de un partido como ids de texto, con null donde todavía no se sabe. */
function parejasDe(p: any): (string | null)[] {
  assert.ok(Array.isArray(p?.parejas) && p.parejas.length === 2, `parejas es una lista de dos: ${JSON.stringify(p)}`);
  return p.parejas.map(id);
}

/** Los campos de un partido que fija la spec, con los ids como texto (sin el campo ganadora no vale como null). */
function vista(p: any) {
  return {
    ronda: p?.ronda,
    numero: p?.numero,
    parejas: Array.isArray(p?.parejas) ? p.parejas.map(id) : p?.parejas,
    estado: p?.estado,
    ganadora: p?.ganadora === undefined ? undefined : id(p.ganadora),
    marcador: p?.marcador,
    pistaId: p?.pistaId,
    inicio: p?.inicio,
  };
}

/** Las combinaciones de pista y franja que le han tocado a algún partido, como "pista|inicio". */
function combinacionesConPartido(torneo: any): Set<string> {
  assert.ok(Array.isArray(torneo?.partidos), `el torneo trae la lista partidos: ${JSON.stringify(torneo)?.slice(0, 500)}`);
  const conHora = torneo.partidos.filter((p: any) => p?.pistaId !== null && p?.pistaId !== undefined && p?.inicio !== null && p?.inicio !== undefined);
  return new Set(conHora.map((p: any) => `${p.pistaId}|${p.inicio}`));
}

/** Una franja de una pista en GET /api/disponibilidad. */
async function franjaEn(api: Api, pistaId: string, inicio: string): Promise<any> {
  const r = await api.pedir("GET", `/api/disponibilidad?fecha=${inicio.slice(0, 10)}&pista=${pistaId}`);
  assert.equal(r.status, 200, `disponibilidad de ${pistaId} el ${inicio.slice(0, 10)}: ${r.texto.slice(0, 500)}`);
  const franja = r.cuerpo?.pistas?.[0]?.franjas?.find((f: any) => f?.inicio === inicio);
  assert.ok(franja, `la disponibilidad trae la franja ${inicio} de ${pistaId}: ${r.texto.slice(0, 500)}`);
  return franja;
}

/** Una reserva normal, como siempre. */
function reservar(api: Api, socioId: string, pistaId: string, inicio: string) {
  return api.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio } });
}

// ---- Tests ----

async function total(api: Api, consulta: string): Promise<number> {
  const r = await api.pedir("GET", `/api/reservas${consulta}`);
  assert.equal(r.status, 200, `GET /api/reservas${consulta}: ${r.texto.slice(0, 500)}`);
  return r.cuerpo.total;
}

prueba("C23 · los partidos de un torneo no salen en GET /api/reservas", async (api) => {
  const socios = await sociosAlDia(api, 8);
  const antes = await total(api, "?limite=1");
  const { torneo, parejas: P } = await torneoCerrado(api, 4, { socios, dias: [SABADO] });
  const comprobar = async (cuando: string) => {
    assert.equal(await total(api, "?limite=1"), antes, `${cuando}: el total de reservas no cambia`);
    assert.equal(await total(api, `?fecha=${SABADO}`), 0, `${cuando}: el sábado no hay reservas`);
    for (const pistaId of ["pista-1", "pista-2", "pista-3"]) {
      assert.equal(await total(api, `?pista=${pistaId}&desde=2027-01-01`), 0, `${cuando}: ${pistaId} no tiene reservas en 2027`);
    }
    for (const socio of socios) assert.equal(await total(api, `?socio=${socio}&desde=2027-01-01`), 0, `${cuando}: ${socio} no tiene reservas en 2027`);
  };
  await comprobar("al cerrar");
  // Y tampoco cuando se juegan.
  await reloj(api, DESPUES);
  await apuntarResultado(api, torneo.id, partido(torneo, 1, 1), P[0]!);
  await apuntarResultado(api, torneo.id, partido(torneo, 1, 2), P[1]!);
  await apuntarResultado(api, torneo.id, partido(await consultar(api, torneo.id), 2, 1), P[0]!);
  await comprobar("con el torneo terminado");
});

prueba("C23 · los partidos no cuentan para el límite de 3 reservas futuras de sus jugadores", async (api) => {
  const socios = await sociosAlDia(api, 4);
  const t = await crearTorneo(api, { pistas: ["pista-1"], franjas: [`${SABADO}T09:00`] });
  await inscribirParejas(api, t.id, socios, 2);
  const torneo = await cerrarYConsultar(api, t.id);
  assert.equal(partido(torneo, 1, 1).inicio, `${SABADO}T09:00`, "los cuatro juegan la final el sábado 16: un partido futuro");
  for (const [s, socio] of socios.entries()) {
    const hora = HORAS[s]!;
    for (const dia of ["11", "12", "13"]) {
      const r = await reservar(api, socio, "pista-2", `2027-01-${dia}T${hora}`);
      assert.equal(r.status, 201, `la reserva ${dia} de ${socio}: ${r.texto}`);
    }
    // El límite sigue siendo de 3 reservas.
    esError(await reservar(api, socio, "pista-2", `2027-01-14T${hora}`), 409, "LIMITE_DE_RESERVAS", `la cuarta de ${socio}:`);
  }
});
