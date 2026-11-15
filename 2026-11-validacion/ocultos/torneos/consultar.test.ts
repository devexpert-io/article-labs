// Tests ocultos de la spec `torneos`: crear y consultar un torneo (C4) y el listado (C5).
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

function idValido(x: unknown): boolean {
  return (typeof x === "string" && x !== "") || (typeof x === "number" && Number.isFinite(x));
}

/** Los campos del torneo que fija la spec. */
function delTorneo(t: any) {
  return {
    id: id(t?.id),
    nombre: t?.nombre,
    pistas: t?.pistas,
    franjas: t?.franjas,
    plazas: t?.plazas,
    cuota: t?.cuota,
    estado: t?.estado,
    inscripciones: t?.inscripciones,
    partidos: t?.partidos,
    campeona: t?.campeona,
  };
}

/** Una inscripción: sus socios (en cualquier orden), su estado y su importe. */
function deLaInscripcion(i: any) {
  return { id: id(i?.id), socios: Array.isArray(i?.socios) ? i.socios.map(String).sort() : i?.socios, estado: i?.estado, importe: i?.importe };
}

prueba("C4 · POST /api/torneos responde 201 { torneo } en estado inscripcion, con sus datos, sin inscripciones ni partidos y con campeona null", async (api) => {
  const pedido = { nombre: "Open de invierno", pistas: ["pista-3", "pista-1"], franjas: [`${SABADO}T09:00`, `${SABADO}T10:30`, `${DOMINGO}T12:00`], plazas: 12, cuota: 2500 };
  const r = await pedirTorneo(api, pedido);
  assert.equal(r.status, 201, r.texto);
  const t = r.cuerpo?.torneo;
  assert.ok(t && typeof t === "object", `la respuesta es { torneo }: ${r.texto}`);
  assert.ok(idValido(t.id), `el torneo trae id: ${r.texto}`);
  const { id: _, ...datos } = delTorneo(t);
  assert.deepEqual(datos, { ...pedido, estado: "inscripcion", inscripciones: [], partidos: [], campeona: null });
});

prueba("C4 · el torneo trae sus franjas en orden cronológico aunque se pidan desordenadas", async (api) => {
  const franjas = [`${DOMINGO}T09:00`, `${SABADO}T21:00`, `${SABADO}T09:00`, `${SABADO}T10:30`];
  const ordenadas = [`${SABADO}T09:00`, `${SABADO}T10:30`, `${SABADO}T21:00`, `${DOMINGO}T09:00`];
  const t = await crearTorneo(api, { franjas });
  assert.deepEqual(t.franjas, ordenadas, "en la respuesta de crear");
  assert.deepEqual((await consultar(api, t.id)).franjas, ordenadas, "en GET /api/torneos/:id");
});

prueba("C4 · GET /api/torneos/:id devuelve { torneo } con sus datos, sus inscripciones y sus partidos", async (api) => {
  const socios = await sociosAlDia(api, 4);
  const creado = await crearTorneo(api, { nombre: "Torneo de Reyes", pistas: ["pista-2"], cuota: 1800 });
  const r = await api.pedir("GET", ruta(creado.id));
  assert.equal(r.status, 200, r.texto);
  assert.ok(r.cuerpo?.torneo && typeof r.cuerpo.torneo === "object", `la respuesta es { torneo }: ${r.texto}`);
  assert.deepEqual(delTorneo(r.cuerpo.torneo), delTorneo(creado), "GET devuelve el torneo recién creado");

  const parejas = await inscribirParejas(api, creado.id, socios, 2);
  const conInscripciones = await consultar(api, creado.id);
  assert.deepEqual(conInscripciones.inscripciones.map(deLaInscripcion), [
    { id: parejas[0], socios: [socios[0], socios[1]].sort(), estado: "inscrita", importe: 1800 },
    { id: parejas[1], socios: [socios[2], socios[3]].sort(), estado: "inscrita", importe: 1800 },
  ]);
  assert.deepEqual(conInscripciones.partidos, [], "antes de cerrar no hay partidos");

  esExito(await cerrar(api, creado.id), "cerrar:");
  const conPartidos = await consultar(api, creado.id);
  assert.ok(Array.isArray(conPartidos.partidos) && conPartidos.partidos.length === 1, `con 2 parejas, la final es el único partido: ${JSON.stringify(conPartidos.partidos)}`);
  assert.deepEqual(conPartidos.inscripciones.map(deLaInscripcion), conInscripciones.inscripciones.map(deLaInscripcion), "y sigue trayendo sus inscripciones");
});

prueba("C4 · si el torneo no existe, 404 TORNEO_NO_ENCONTRADO en todos sus endpoints", async (api) => {
  const socios = await sociosAlDia(api, 6);
  esError(await api.pedir("GET", ruta("1")), 404, "TORNEO_NO_ENCONTRADO", "GET antes de crear ningún torneo:");
  // Un torneo de verdad, con inscripciones y partidos, para usar sus ids con un torneo que no existe.
  const t = await crearTorneo(api);
  const [p1] = await inscribirParejas(api, t.id, socios, 2);
  const final = partido(await cerrarYConsultar(api, t.id), 1, 1);
  for (const otro of ["no-existe", "T-9999", "999999"]) {
    if (otro === id(t.id)) continue;
    esError(await api.pedir("GET", ruta(otro)), 404, "TORNEO_NO_ENCONTRADO", `GET /api/torneos/${otro}:`);
    esError(await inscribir(api, otro, [socios[4], socios[5]]), 404, "TORNEO_NO_ENCONTRADO", `inscribir en ${otro}:`);
    esError(await darDeBaja(api, otro, p1), 404, "TORNEO_NO_ENCONTRADO", `dar de baja en ${otro}:`);
    esError(await cerrar(api, otro), 404, "TORNEO_NO_ENCONTRADO", `cerrar ${otro}:`);
    esError(await apuntar(api, otro, final.id, { ganadora: p1 }), 404, "TORNEO_NO_ENCONTRADO", `apuntar en ${otro}:`);
    esError(await cancelarTorneo(api, otro), 404, "TORNEO_NO_ENCONTRADO", `cancelar ${otro}:`);
  }
});

/**
 * Cinco torneos en la pista 1, creados fuera del orden de su primera franja: uno terminado, uno en juego, uno cancelado y dos
 * en inscripción. Dos se piden con las franjas desordenadas, para que su primera franja no sea la primera de la petición.
 */
async function cincoTorneos(api: Api) {
  const socios = await sociosAlDia(api, 14);
  const enJuego = await crearTorneo(api, { nombre: "En juego", franjas: ["2027-01-23T09:00", "2027-01-23T10:30", "2027-01-23T12:00", "2027-01-23T13:30"], plazas: 8, cuota: 1000 });
  const deFebrero = await crearTorneo(api, { nombre: "Inscripción de febrero", franjas: ["2027-02-06T18:00"], plazas: 16, cuota: 0 });
  const cancelado = await crearTorneo(api, { nombre: "Cancelado", franjas: ["2027-01-30T12:00", "2027-01-20T12:00"], plazas: 4, cuota: 2000 });
  const terminado = await crearTorneo(api, { nombre: "Terminado", franjas: [`${SABADO}T09:00`], plazas: 6, cuota: 1500 });
  const deEnero = await crearTorneo(api, { nombre: "Inscripción de enero", franjas: ["2027-01-27T19:30", "2027-01-21T19:30"], plazas: 10, cuota: 3000 });

  const [t1] = await inscribirParejas(api, terminado.id, socios.slice(0, 4), 2);
  const final = partido(await cerrarYConsultar(api, terminado.id), 1, 1);
  const deEnJuego = await inscribirParejas(api, enJuego.id, socios.slice(4, 12), 4);
  esExito(await darDeBaja(api, enJuego.id, deEnJuego[1]), "dar de baja una pareja del torneo en juego:");
  esExito(await cerrar(api, enJuego.id), "cerrar el torneo en juego:");
  esExito(await cancelarTorneo(api, cancelado.id), "cancelar:");
  await inscribirParejas(api, deEnero.id, socios.slice(12, 14), 1);
  await reloj(api, DESPUES);
  await apuntarResultado(api, terminado.id, final, t1!);

  // Por orden de su primera franja: el 16 de enero, el 20, el 21, el 23 y el 6 de febrero.
  return {
    ordenados: [terminado, cancelado, deEnero, enJuego, deFebrero],
    esperado: [
      { id: id(terminado.id), nombre: "Terminado", estado: "terminado", plazas: 6, cuota: 1500, inscritas: 2 },
      { id: id(cancelado.id), nombre: "Cancelado", estado: "cancelado", plazas: 4, cuota: 2000, inscritas: 0 },
      { id: id(deEnero.id), nombre: "Inscripción de enero", estado: "inscripcion", plazas: 10, cuota: 3000, inscritas: 1 },
      { id: id(enJuego.id), nombre: "En juego", estado: "en_juego", plazas: 8, cuota: 1000, inscritas: 3 },
      { id: id(deFebrero.id), nombre: "Inscripción de febrero", estado: "inscripcion", plazas: 16, cuota: 0, inscritas: 0 },
    ],
  };
}

function resumen(t: any) {
  return { id: id(t?.id), nombre: t?.nombre, estado: t?.estado, plazas: t?.plazas, cuota: t?.cuota, inscritas: t?.inscritas };
}

prueba("C5 · GET /api/torneos devuelve { torneos }: todos, también los cancelados, por orden de su primera franja, con id, nombre, estado, plazas, cuota e inscritas", async (api) => {
  const { esperado } = await cincoTorneos(api);
  const r = await api.pedir("GET", "/api/torneos");
  assert.equal(r.status, 200, r.texto.slice(0, 500));
  assert.ok(Array.isArray(r.cuerpo?.torneos), `la respuesta es { torneos }: ${r.texto.slice(0, 500)}`);
  assert.deepEqual(r.cuerpo.torneos.map(resumen), esperado);
});

prueba("C5 · con estado, solo los torneos de ese estado, en el mismo orden", async (api) => {
  const { esperado } = await cincoTorneos(api);
  for (const estado of ["inscripcion", "en_juego", "terminado", "cancelado"]) {
    const r = await api.pedir("GET", `/api/torneos?estado=${estado}`);
    assert.equal(r.status, 200, `?estado=${estado}: ${r.texto.slice(0, 500)}`);
    assert.ok(Array.isArray(r.cuerpo?.torneos), `la respuesta es { torneos }: ${r.texto.slice(0, 500)}`);
    assert.deepEqual(r.cuerpo.torneos.map(resumen), esperado.filter((t) => t.estado === estado), `?estado=${estado}`);
  }
});

prueba("C5 · con un estado que no existe, 400 DATOS_INVALIDOS", async (api) => {
  await crearTorneo(api);
  for (const estado of ["abierto", "pendiente", "cancelada", "jugado", "baja"]) {
    esError(await api.pedir("GET", `/api/torneos?estado=${estado}`), 400, "DATOS_INVALIDOS", `?estado=${estado}:`);
  }
});
