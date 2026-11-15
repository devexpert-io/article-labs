// Tests ocultos de la spec `torneos`: inscribirse (C7), quién puede jugar (C8), las plazas (C9), el plazo de inscripción (C10)
// y la baja (C11).
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en test-ocultos/
// dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test. Cada prueba arranca su propia API.
// Cada petición tiene un solo problema, para no depender del orden en que la implementación comprueba las cosas.
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

/** Una inscripción: sus socios (en cualquier orden, la spec no lo fija), su estado y su importe. */
function deLaInscripcion(i: any) {
  return { socios: Array.isArray(i?.socios) ? i.socios.map(String).sort() : i?.socios, estado: i?.estado, importe: i?.importe };
}

prueba("C7 · inscribirse responde 201 con la inscripción inscrita y el importe de la cuota, y la inscripción queda al final de inscripciones", async (api) => {
  const [a, b, c, d, e, f, g, h] = await sociosAlDia(api, 8);
  const t = await crearTorneo(api, { cuota: 2500 });
  const vistas: (string | null)[] = [];
  for (const pareja of [[a, b], [c, d], [f, e]]) {
    const r = await inscribir(api, t.id, pareja);
    assert.equal(r.status, 201, `inscribir a ${pareja.join(" y ")}: ${r.texto}`);
    const inscripcion = r.cuerpo?.inscripcion;
    assert.ok(inscripcion && id(inscripcion.id) !== null, `la respuesta es { inscripcion } con su id: ${r.texto}`);
    assert.deepEqual(deLaInscripcion(inscripcion), { socios: [...pareja].sort(), estado: "inscrita", importe: 2500 });
    vistas.push(id(inscripcion.id));
    const torneo = await consultar(api, t.id);
    assert.deepEqual(inscripcionesDe(torneo).map(([x]) => x), vistas, "la nueva inscripción queda al final de inscripciones");
    assert.deepEqual(deLaInscripcion(torneo.inscripciones.at(-1)), deLaInscripcion(inscripcion), "y es la misma que la de la respuesta");
  }
  // Con cuota 0, el importe es 0.
  const gratis = await crearTorneo(api, { pistas: ["pista-2"], cuota: 0 });
  const r = await inscribir(api, gratis.id, [g, h]);
  assert.equal(r.status, 201, r.texto);
  assert.deepEqual(deLaInscripcion(r.cuerpo?.inscripcion), { socios: [g, h].sort(), estado: "inscrita", importe: 0 });
});

prueba("C7 · socios tiene que ser una lista con dos ids distintos: si no, 400 DATOS_INVALIDOS y no se inscribe a nadie", async (api) => {
  const [a, b, c] = await sociosAlDia(api, 3);
  const t = await crearTorneo(api);
  for (const socios of [undefined, null, [], [a], [a, a], [a, b, c], a, { a, b }]) {
    esError(await inscribir(api, t.id, socios), 400, "DATOS_INVALIDOS", `socios = ${JSON.stringify(socios)}:`);
  }
  assert.deepEqual(inscripcionesDe(await consultar(api, t.id)), [], "no se inscribe a nadie");
});

prueba("C8 · los dos socios tienen que existir: si no, 404 SOCIO_NO_ENCONTRADO", async (api) => {
  const [a] = await sociosAlDia(api, 1);
  const t = await crearTorneo(api);
  for (const socios of [[a, "socio-999"], ["socio-999", a], ["no-existe", "socio-998"]]) {
    esError(await inscribir(api, t.id, socios), 404, "SOCIO_NO_ENCONTRADO", `socios = ${JSON.stringify(socios)}:`);
  }
  assert.deepEqual(inscripcionesDe(await consultar(api, t.id)), [], "no se inscribe a nadie");
});

prueba("C8 · los dos socios tienen que tener la cuota al día: si no, 409 CUOTA_INACTIVA", async (api) => {
  const [a] = await sociosAlDia(api, 1);
  const [m1, m2] = await sociosSinCuota(api);
  const t = await crearTorneo(api);
  for (const socios of [[a, m1], [m1, a], [m1, m2]]) {
    esError(await inscribir(api, t.id, socios), 409, "CUOTA_INACTIVA", `socios = ${JSON.stringify(socios)}:`);
  }
  assert.deepEqual(inscripcionesDe(await consultar(api, t.id)), [], "no se inscribe a nadie");
});

prueba("C8 · ninguno de los dos puede estar ya en otra inscripción inscrita del mismo torneo: 409 YA_INSCRITO; en otro torneo, sí", async (api) => {
  const [a, b, c] = await sociosAlDia(api, 3);
  const t = await crearTorneo(api);
  const primera = await inscribirPareja(api, t.id, [a, b]);
  for (const socios of [[a, c], [c, b], [b, a], [a, b]]) {
    esError(await inscribir(api, t.id, socios), 409, "YA_INSCRITO", `socios = ${JSON.stringify(socios)}:`);
  }
  assert.deepEqual(inscripcionesDe(await consultar(api, t.id)), [[primera, "inscrita"]], "no se inscribe a nadie más");
  const otro = await crearTorneo(api, { pistas: ["pista-2"] });
  esExito(await inscribir(api, otro.id, [a, c]), "en otro torneo:");
});

prueba("C9 · con tantas inscripciones inscritas como plazas, 409 TORNEO_COMPLETO", async (api) => {
  const socios = await sociosAlDia(api, 10);
  const t = await crearTorneo(api, { plazas: 4 });
  await inscribirParejas(api, t.id, socios, 4);
  esError(await inscribir(api, t.id, [socios[8], socios[9]]), 409, "TORNEO_COMPLETO");
  assert.equal(inscripcionesDe(await consultar(api, t.id)).length, 4, "no se inscribe a nadie más");
});

prueba("C9 · las bajas dejan su plaza libre", async (api) => {
  const socios = await sociosAlDia(api, 12);
  const t = await crearTorneo(api, { plazas: 4 });
  const parejas = await inscribirParejas(api, t.id, socios, 4);
  esExito(await darDeBaja(api, t.id, parejas[1]), "dar de baja una pareja:");
  esExito(await inscribir(api, t.id, [socios[8], socios[9]]), "con una baja queda una plaza:");
  esError(await inscribir(api, t.id, [socios[10], socios[11]]), 409, "TORNEO_COMPLETO", "otra vez completo:");
});

// La primera franja de estos torneos es la del sábado 16 a las 10:30: el plazo acaba el jueves 14 a las 10:30.
const PRIMERA = `${SABADO}T10:30`;

prueba("C10 · se puede inscribir y dar de baja mientras falten 48 horas o más para la primera franja, también a 48 horas justas", async (api) => {
  const [a, b, c, d] = await sociosAlDia(api, 4);
  const t = await crearTorneo(api, { franjas: [PRIMERA, `${SABADO}T12:00`] });
  await reloj(api, "2027-01-14T10:29"); // faltan 48 horas y 1 minuto
  const primera = await inscribir(api, t.id, [a, b]);
  esExito(primera, "a 48 horas y 1 minuto, inscribirse:");
  await reloj(api, "2027-01-14T10:30"); // faltan 48 horas justas
  esExito(await inscribir(api, t.id, [c, d]), "a 48 horas justas, inscribirse:");
  esExito(await darDeBaja(api, t.id, (primera.cuerpo?.inscripcion ?? primera.cuerpo).id), "a 48 horas justas, darse de baja:");
});

prueba("C10 · con menos de 48 horas para la primera franja, inscribirse y darse de baja dan 409 INSCRIPCION_CERRADA", async (api) => {
  const [a, b, c, d] = await sociosAlDia(api, 4);
  const t = await crearTorneo(api, { franjas: [PRIMERA, `${SABADO}T12:00`] });
  const inscrita = await inscribirPareja(api, t.id, [a, b]);
  for (const ahora of ["2027-01-14T10:31", "2027-01-15T18:00", "2027-01-16T10:00"]) {
    await reloj(api, ahora);
    esError(await inscribir(api, t.id, [c, d]), 409, "INSCRIPCION_CERRADA", `${ahora}, inscribirse:`);
    esError(await darDeBaja(api, t.id, inscrita), 409, "INSCRIPCION_CERRADA", `${ahora}, darse de baja:`);
  }
  assert.deepEqual(inscripcionesDe(await consultar(api, t.id)), [[inscrita, "inscrita"]], "no cambia nada");
});

prueba("C10 · el plazo cuenta desde la franja más temprana del torneo, aunque no sea la primera de la petición", async (api) => {
  const [a, b] = await sociosAlDia(api, 2);
  const t = await crearTorneo(api, { franjas: ["2027-01-20T18:00", PRIMERA] });
  await reloj(api, "2027-01-14T10:31"); // 47 h 59 min antes del sábado 16 a las 10:30, y casi seis días antes del miércoles 20
  esError(await inscribir(api, t.id, [a, b]), 409, "INSCRIPCION_CERRADA");
});

prueba("C10 · con el torneo en juego, inscribirse y darse de baja dan 409 INSCRIPCION_CERRADA aunque falten más de 48 horas", async (api) => {
  const socios = await sociosAlDia(api, 6);
  const t = await crearTorneo(api);
  const [p1] = await inscribirParejas(api, t.id, socios, 2);
  esExito(await cerrar(api, t.id), "cerrar:");
  // El reloj sigue en el lunes 4: faltan 12 días para la primera franja.
  esError(await inscribir(api, t.id, [socios[4], socios[5]]), 409, "INSCRIPCION_CERRADA", "inscribirse:");
  esError(await darDeBaja(api, t.id, p1), 409, "INSCRIPCION_CERRADA", "darse de baja:");
  assert.equal(inscripcionesDe(await consultar(api, t.id)).filter(([, estado]) => estado === "inscrita").length, 2, "no cambia nada");
});

prueba("C10 · con el torneo cancelado, inscribirse da 409 INSCRIPCION_CERRADA aunque falten más de 48 horas", async (api) => {
  const [a, b] = await sociosAlDia(api, 2);
  const t = await crearTorneo(api);
  esExito(await cancelarTorneo(api, t.id), "cancelar:");
  esError(await inscribir(api, t.id, [a, b]), 409, "INSCRIPCION_CERRADA");
  assert.deepEqual(inscripcionesDe(await consultar(api, t.id)), [], "no se inscribe a nadie");
});

prueba("C11 · dar de baja responde con la inscripción en estado baja y la deja en su sitio en inscripciones", async (api) => {
  const socios = await sociosAlDia(api, 6);
  const t = await crearTorneo(api);
  const [p1, p2, p3] = await inscribirParejas(api, t.id, socios, 3);
  const r = await darDeBaja(api, t.id, p2);
  assert.equal(r.status, 200, r.texto);
  const inscripcion = r.cuerpo?.inscripcion;
  assert.ok(inscripcion && id(inscripcion.id) === p2, `la respuesta es { inscripcion } con la dada de baja: ${r.texto}`);
  assert.deepEqual([deLaInscripcion(inscripcion).socios, inscripcion.estado], [[socios[2], socios[3]].sort(), "baja"]);
  assert.deepEqual(inscripcionesDe(await consultar(api, t.id)), [[p1, "inscrita"], [p2, "baja"], [p3, "inscrita"]]);
});

prueba("C11 · los dos socios de una pareja dada de baja se pueden volver a inscribir, juntos o con otros", async (api) => {
  const [a, b, c, d, e, f] = await sociosAlDia(api, 6);
  const t = await crearTorneo(api);
  const [p1, p2] = await inscribirParejas(api, t.id, [a, b, c, d], 2);
  esExito(await darDeBaja(api, t.id, p1), "dar de baja a a y b:");
  esExito(await darDeBaja(api, t.id, p2), "dar de baja a c y d:");
  const juntos = await inscribirPareja(api, t.id, [b, a]);
  const conE = await inscribirPareja(api, t.id, [c, e]);
  const conF = await inscribirPareja(api, t.id, [f, d]);
  assert.deepEqual(inscripcionesDe(await consultar(api, t.id)), [[p1, "baja"], [p2, "baja"], [juntos, "inscrita"], [conE, "inscrita"], [conF, "inscrita"]]);
});

prueba("C11 · si la inscripción no existe en ese torneo, 404 INSCRIPCION_NO_ENCONTRADA", async (api) => {
  const [a, b] = await sociosAlDia(api, 2);
  const t = await crearTorneo(api);
  const otro = await crearTorneo(api, { pistas: ["pista-2"] });
  const delOtro = await inscribirPareja(api, otro.id, [a, b]);
  for (const inscripcionId of [delOtro, "no-existe", "I-9999"]) {
    esError(await darDeBaja(api, t.id, inscripcionId), 404, "INSCRIPCION_NO_ENCONTRADA", `${inscripcionId}:`);
  }
  assert.deepEqual(inscripcionesDe(await consultar(api, otro.id)), [[delOtro, "inscrita"]], "la del otro torneo sigue inscrita");
});

prueba("C11 · si la inscripción ya estaba de baja, 409 YA_DE_BAJA", async (api) => {
  const socios = await sociosAlDia(api, 2);
  const t = await crearTorneo(api);
  const [p1] = await inscribirParejas(api, t.id, socios, 1);
  esExito(await darDeBaja(api, t.id, p1), "la primera baja:");
  esError(await darDeBaja(api, t.id, p1), 409, "YA_DE_BAJA", "como el gestor:");
  esError(await darDeBaja(api, t.id, p1, socios[0]), 409, "YA_DE_BAJA", "como uno de sus socios:");
  assert.deepEqual(inscripcionesDe(await consultar(api, t.id)), [[p1, "baja"]]);
});
