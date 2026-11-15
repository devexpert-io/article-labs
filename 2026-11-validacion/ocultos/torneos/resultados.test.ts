// Tests ocultos de la spec `torneos`: apuntar un resultado (C18), la ganadora pasa de ronda (C19), corregir un resultado (C20)
// y la campeona (C21).
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en test-ocultos/
// dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test. Cada prueba arranca su propia API.
// Cada partido se busca por su ronda y su número, y cada pareja, por el id de su inscripción (P[0] es la pareja 1). Salvo en
// la prueba de la hora, el reloj se mueve a DESPUES para que todos los partidos hayan empezado. Cuando hay dos torneos, cada
// uno tiene sus socios. En qué sitio de `parejas` va cada ganadora se prueba en C14: aquí no se mira el orden.
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

const sinOrden = (parejas: (string | null)[]) => [...parejas].sort((a, b) => String(a).localeCompare(String(b)));

/** Las parejas de un partido, sin mirar el orden. */
function juntas(p: any): (string | null)[] {
  return sinOrden(parejasDe(p));
}

prueba("C18 · apuntar un resultado responde { partido } jugado, con la ganadora y el marcador", async (api) => {
  const { torneo, parejas: P } = await torneoCerrado(api, 4);
  const semifinal = partido(torneo, 1, 1); // 1 contra 4
  await reloj(api, DESPUES);
  const r = await apuntar(api, torneo.id, semifinal.id, { ganadora: P[3], marcador: "6-4 3-6 10-7" });
  assert.equal(r.status, 200, r.texto);
  const p = r.cuerpo?.partido;
  assert.ok(p && id(p.id) === id(semifinal.id), `la respuesta es { partido } con el partido apuntado: ${r.texto}`);
  const esperado = { ...vista(semifinal), estado: "jugado", ganadora: P[3], marcador: "6-4 3-6 10-7" };
  assert.deepEqual(vista(p), esperado);
  assert.deepEqual(vista(partido(await consultar(api, torneo.id), 1, 1)), esperado, "GET /api/torneos/:id trae el resultado");
});

prueba("C18 · sin marcador, el resultado se apunta con marcador null", async (api) => {
  const { torneo, parejas: P } = await torneoCerrado(api, 4);
  await reloj(api, DESPUES);
  const r = await apuntar(api, torneo.id, partido(torneo, 1, 2).id, { ganadora: P[1] });
  assert.equal(r.status, 200, r.texto);
  const p = r.cuerpo?.partido ?? r.cuerpo;
  assert.deepEqual([p?.estado, id(p?.ganadora), p?.marcador], ["jugado", P[1], null]);
  const guardado = partido(await consultar(api, torneo.id), 1, 2);
  assert.deepEqual([guardado.estado, id(guardado.ganadora), guardado.marcador], ["jugado", P[1], null]);
});

prueba("C18 · la ganadora tiene que ser una de las dos parejas del partido: si no, 400 DATOS_INVALIDOS", async (api) => {
  const { torneo, parejas: P } = await torneoCerrado(api, 4);
  const semifinal = partido(torneo, 1, 1); // 1 contra 4
  await reloj(api, DESPUES);
  // La pareja 2 juega la otra semifinal.
  for (const cuerpo of [{ ganadora: P[1] }, { ganadora: "no-existe" }, { ganadora: null }, {}, { marcador: "6-0 6-0" }]) {
    esError(await apuntar(api, torneo.id, semifinal.id, cuerpo), 400, "DATOS_INVALIDOS", `${JSON.stringify(cuerpo)}:`);
  }
  assert.deepEqual(vista(partido(await consultar(api, torneo.id), 1, 1)), vista(semifinal), "el partido sigue igual");
});

prueba("C18 · solo con el torneo en juego: en uno terminado o en uno cancelado, 409 TORNEO_NO_EN_JUEGO", async (api) => {
  const socios = await sociosAlDia(api, 8);
  const terminado = await torneoCerrado(api, 2, { socios: socios.slice(0, 4), dias: [SABADO] });
  const cancelado = await torneoCerrado(api, 2, { socios: socios.slice(4), dias: [DOMINGO] });
  esExito(await cancelarTorneo(api, cancelado.torneo.id), "cancelar:");
  await reloj(api, DESPUES);
  const final = partido(terminado.torneo, 1, 1);
  await apuntarResultado(api, terminado.torneo.id, final, terminado.parejas[0]!, "6-1 6-1");
  // Con 2 parejas, la final no tiene partido siguiente: lo único que lo impide es que el torneo ha terminado.
  esError(await apuntar(api, terminado.torneo.id, final.id, { ganadora: terminado.parejas[1], marcador: "6-1 6-1" }), 409, "TORNEO_NO_EN_JUEGO", "terminado:");
  const despues = await consultar(api, terminado.torneo.id);
  assert.deepEqual([despues.estado, id(despues.campeona), id(partido(despues, 1, 1).ganadora)], ["terminado", terminado.parejas[0], terminado.parejas[0]], "no cambia nada");

  // La final del torneo cancelado tiene sus dos parejas y ya ha empezado: lo único que lo impide es que está cancelado.
  const pendiente = partido(cancelado.torneo, 1, 1);
  esError(await apuntar(api, cancelado.torneo.id, pendiente.id, { ganadora: cancelado.parejas[0] }), 409, "TORNEO_NO_EN_JUEGO", "cancelado:");
  assert.equal((await consultar(api, cancelado.torneo.id)).estado, "cancelado", "sigue cancelado");
});

prueba("C18 · si alguna pareja del partido no se sabe todavía, o si es un descanso, 409 PARTIDO_NO_LISTO", async (api) => {
  const socios = await sociosAlDia(api, 14);
  const cuatro = await torneoCerrado(api, 4, { socios: socios.slice(0, 8), dias: [SABADO] });
  const tres = await torneoCerrado(api, 3, { socios: socios.slice(8), dias: [DOMINGO] });
  await reloj(api, DESPUES); // todos los partidos han empezado
  // Con 4 parejas, cuando solo se ha jugado la primera semifinal, la final tiene una pareja sin saber. La ganadora que se pide
  // es la que ya está en la final.
  const ganadora = cuatro.parejas[0]!;
  await apuntarResultado(api, cuatro.torneo.id, partido(cuatro.torneo, 1, 1), ganadora);
  const final = partido(await consultar(api, cuatro.torneo.id), 2, 1);
  assert.deepEqual(juntas(final), sinOrden([ganadora, null]), "la final, con una pareja sin saber (C19)");
  esError(await apuntar(api, cuatro.torneo.id, final.id, { ganadora }), 409, "PARTIDO_NO_LISTO", "con una pareja sin saber:");
  assert.deepEqual(vista(partido(await consultar(api, cuatro.torneo.id), 2, 1)), vista(final), "la final sigue igual");
  // Con 3 parejas, el partido 1 es el descanso de la pareja 1.
  const enDescanso = partido(tres.torneo, 1, 1);
  esError(await apuntar(api, tres.torneo.id, enDescanso.id, { ganadora: tres.parejas[0] }), 409, "PARTIDO_NO_LISTO", "un descanso:");
  assert.deepEqual(vista(partido(await consultar(api, tres.torneo.id), 1, 1)), vista(enDescanso), "el descanso sigue igual");
});

prueba("C18 · antes de la hora del partido, 409 PARTIDO_NO_EMPEZADO; a su hora ya se puede apuntar", async (api) => {
  const socios = await sociosAlDia(api, 4);
  // Con una sola combinación de franja y pista, la final es el sábado a las 10:30.
  const t = await crearTorneo(api, { pistas: ["pista-1"], franjas: [`${SABADO}T10:30`] });
  const P = await inscribirParejas(api, t.id, socios, 2);
  const final = partido(await cerrarYConsultar(api, t.id), 1, 1);
  for (const ahora of [ENERO, `${SABADO}T09:00`, `${SABADO}T10:29`]) {
    await reloj(api, ahora);
    esError(await apuntar(api, t.id, final.id, { ganadora: P[0] }), 409, "PARTIDO_NO_EMPEZADO", `${ahora}:`);
  }
  assert.equal(partido(await consultar(api, t.id), 1, 1).estado, "pendiente", "sigue pendiente");
  await reloj(api, `${SABADO}T10:30`);
  const r = await apuntar(api, t.id, final.id, { ganadora: P[0], marcador: "6-2 6-2" });
  assert.equal(r.status, 200, `a la hora del partido: ${r.texto}`);
});

prueba("C18 · si el partido no existe en ese torneo, 404 PARTIDO_NO_ENCONTRADO", async (api) => {
  const socios = await sociosAlDia(api, 20);
  const grande = await torneoCerrado(api, 8, { socios: socios.slice(0, 16), dias: [SABADO] }); // 7 partidos
  const pequeno = await torneoCerrado(api, 2, { socios: socios.slice(16), dias: [DOMINGO] }); // 1 partido
  await reloj(api, DESPUES);
  const delPequeno = new Set(pequeno.torneo.partidos.map((p: any) => id(p.id)));
  const ajeno = grande.torneo.partidos.find((p: any) => !delPequeno.has(id(p.id)));
  assert.ok(ajeno, "algún partido del torneo grande no tiene un id del pequeño");
  for (const partidoId of [ajeno.id, "no-existe", "P-9999"]) {
    esError(await apuntar(api, pequeno.torneo.id, partidoId, { ganadora: pequeno.parejas[0] }), 404, "PARTIDO_NO_ENCONTRADO", `${partidoId}:`);
  }
});

prueba("C19 · la ganadora de un partido pasa al de la ronda siguiente y, cuando ese partido tiene sus dos parejas, ya se puede apuntar", async (api) => {
  const { torneo, parejas: P } = await torneoCerrado(api, 4);
  await reloj(api, DESPUES);
  assert.deepEqual(parejasDe(partido(torneo, 2, 1)), [null, null], "la final, al cerrar");
  await apuntarResultado(api, torneo.id, partido(torneo, 1, 2), P[2]!); // 2-3: gana la 3
  assert.deepEqual(juntas(partido(await consultar(api, torneo.id), 2, 1)), sinOrden([P[2]!, null]), "la ganadora de 2-3 está en la final");
  await apuntarResultado(api, torneo.id, partido(torneo, 1, 1), P[0]!); // 1-4: gana la 1
  const final = partido(await consultar(api, torneo.id), 2, 1);
  assert.deepEqual([juntas(final), final.estado], [sinOrden([P[0]!, P[2]!]), "pendiente"], "la final, con sus dos parejas");
  const r = await apuntar(api, torneo.id, final.id, { ganadora: P[2], marcador: "7-6 7-6" });
  assert.equal(r.status, 200, `apuntar la final: ${r.texto}`);
  assert.equal((r.cuerpo?.partido ?? r.cuerpo)?.estado, "jugado");
});

prueba("C19 · las ganadoras de los descansos pasan de ronda al cerrar", async (api) => {
  const socios = await sociosAlDia(api, 18);
  const tres = await torneoCerrado(api, 3, { socios: socios.slice(0, 6), dias: [SABADO] });
  assert.deepEqual(juntas(partido(tres.torneo, 2, 1)), sinOrden([tres.parejas[0]!, null]), "con 3 parejas, la pareja 1 ya está en la final");
  const seis = await torneoCerrado(api, 6, { socios: socios.slice(6), dias: [DOMINGO] });
  const segunda = rondaDe(seis.torneo, 2).flatMap(parejasDe);
  assert.deepEqual(sinOrden(segunda), sinOrden([seis.parejas[0]!, seis.parejas[1]!, null, null]), "con 6 parejas, las parejas 1 y 2 ya están en la segunda ronda");
  // Cuando se juega 2-3, la final de las 3 parejas ya se puede apuntar.
  await reloj(api, DESPUES);
  await apuntarResultado(api, tres.torneo.id, partido(tres.torneo, 1, 2), tres.parejas[1]!);
  const final = partido(await consultar(api, tres.torneo.id), 2, 1);
  assert.deepEqual(juntas(final), sinOrden([tres.parejas[0]!, tres.parejas[1]!]));
  esExito(await apuntar(api, tres.torneo.id, final.id, { ganadora: tres.parejas[0] }), "apuntar la final:");
});

prueba("C20 · volver a apuntar un partido jugado cambia su resultado y la pareja que pasó a la ronda siguiente", async (api) => {
  const { torneo, parejas: P } = await torneoCerrado(api, 4);
  await reloj(api, DESPUES);
  await apuntarResultado(api, torneo.id, partido(torneo, 1, 1), P[0]!, "6-4 6-4"); // 1-4: gana la 1
  await apuntarResultado(api, torneo.id, partido(torneo, 1, 2), P[1]!, "6-1 6-1"); // 2-3: gana la 2
  assert.deepEqual(juntas(partido(await consultar(api, torneo.id), 2, 1)), sinOrden([P[0]!, P[1]!]));

  // En realidad, la primera semifinal la ganó la pareja 4.
  const r = await apuntar(api, torneo.id, partido(torneo, 1, 1).id, { ganadora: P[3], marcador: "4-6 6-3 10-8" });
  assert.equal(r.status, 200, r.texto);
  const corregido = r.cuerpo?.partido ?? r.cuerpo;
  assert.deepEqual([corregido?.estado, id(corregido?.ganadora), corregido?.marcador], ["jugado", P[3], "4-6 6-3 10-8"]);
  let ahora = await consultar(api, torneo.id);
  assert.deepEqual([id(partido(ahora, 1, 1).ganadora), partido(ahora, 1, 1).marcador], [P[3], "4-6 6-3 10-8"]);
  assert.deepEqual(juntas(partido(ahora, 2, 1)), sinOrden([P[3]!, P[1]!]), "la pareja 4 pasa a la final en lugar de la 1");

  // Y la segunda, la pareja 3.
  esExito(await apuntar(api, torneo.id, partido(torneo, 1, 2).id, { ganadora: P[2], marcador: "7-5 7-5" }), "corregir la segunda semifinal:");
  ahora = await consultar(api, torneo.id);
  assert.deepEqual([id(partido(ahora, 1, 2).ganadora), partido(ahora, 1, 2).marcador], [P[2], "7-5 7-5"]);
  assert.deepEqual(juntas(partido(ahora, 2, 1)), sinOrden([P[3]!, P[2]!]), "la pareja 3 pasa a la final en lugar de la 2");
  assert.deepEqual([ahora.estado, ahora.campeona], ["en_juego", null], "el torneo sigue en juego");
});

prueba("C20 · al corregir un resultado sin marcador, el marcador queda null, como al apuntarlo", async (api) => {
  const { torneo, parejas: P } = await torneoCerrado(api, 4);
  await reloj(api, DESPUES);
  await apuntarResultado(api, torneo.id, partido(torneo, 1, 1), P[0]!, "6-4 6-4");
  esExito(await apuntar(api, torneo.id, partido(torneo, 1, 1).id, { ganadora: P[3] }), "corregir sin marcador:");
  const corregido = partido(await consultar(api, torneo.id), 1, 1);
  assert.deepEqual([corregido.estado, id(corregido.ganadora), corregido.marcador], ["jugado", P[3], null]);
});

prueba("C20 · si el partido de la ronda siguiente ya se jugó, 409 RESULTADO_CERRADO y no cambia nada", async (api) => {
  const { torneo, parejas: P } = await torneoCerrado(api, 8);
  await reloj(api, DESPUES);
  // Primera ronda: 1-8, 2-7, 3-6 y 4-5. Ganan la 1, la 2, la 3 y la 4: la pareja k gana el partido k.
  for (const numero of [1, 2, 3, 4]) await apuntarResultado(api, torneo.id, partido(torneo, 1, numero), P[numero - 1]!, "6-3 6-3");
  // Se juega la primera semifinal (qué partidos la alimentan se prueba en C14: aquí se leen de sus parejas).
  const semifinal = partido(await consultar(api, torneo.id), 2, 1);
  const [ganadora, perdedora] = parejasDe(semifinal) as [string, string];
  const origenes = [1, 2, 3, 4].filter((k) => [ganadora, perdedora].includes(P[k - 1]!));
  assert.equal(origenes.length, 2, `la semifinal la juegan dos ganadoras de la primera ronda: ${JSON.stringify(semifinal)}`);
  await apuntarResultado(api, torneo.id, semifinal, ganadora, "6-2 6-2");
  for (const numero of origenes) {
    // La rival de la pareja k en la primera ronda es la 9 − k.
    esError(await apuntar(api, torneo.id, partido(torneo, 1, numero).id, { ganadora: P[8 - numero], marcador: "7-5 7-5" }), 409, "RESULTADO_CERRADO", `el partido ${numero}:`);
  }
  const despues = await consultar(api, torneo.id);
  for (const numero of origenes) {
    assert.deepEqual([id(partido(despues, 1, numero).ganadora), partido(despues, 1, numero).marcador], [P[numero - 1], "6-3 6-3"], `el partido ${numero} sigue igual`);
  }
  assert.deepEqual(vista(partido(despues, 2, 1)), vista({ ...semifinal, estado: "jugado", ganadora, marcador: "6-2 6-2" }), "la semifinal sigue igual");
  assert.equal(despues.estado, "en_juego");
  // La semifinal sí se puede corregir mientras no se juegue la final.
  esExito(await apuntar(api, torneo.id, semifinal.id, { ganadora: perdedora }), "corregir la semifinal:");
  assert.deepEqual(juntas(partido(await consultar(api, torneo.id), 3, 1)), sinOrden([perdedora, null]), "la nueva ganadora pasa a la final");
});

prueba("C21 · con 2 parejas, el único partido es la final: al apuntarlo, el torneo pasa a terminado y su campeona es la ganadora", async (api) => {
  const { torneo, parejas: P } = await torneoCerrado(api, 2);
  assert.equal(torneo.partidos.length, 1, `un solo partido: ${JSON.stringify(torneo.partidos)}`);
  assert.deepEqual([torneo.estado, torneo.campeona], ["en_juego", null]);
  await reloj(api, DESPUES);
  await apuntarResultado(api, torneo.id, partido(torneo, 1, 1), P[1]!, "6-4 6-4");
  const terminado = await consultar(api, torneo.id);
  assert.deepEqual([terminado.estado, id(terminado.campeona)], ["terminado", P[1]]);
});

prueba("C21 · el torneo sigue en juego y sin campeona hasta que se apunta la final; entonces pasa a terminado y la campeona es la ganadora", async (api) => {
  const { torneo, parejas: P } = await torneoCerrado(api, 4);
  await reloj(api, DESPUES);
  await apuntarResultado(api, torneo.id, partido(torneo, 1, 1), P[3]!); // 1-4: gana la 4
  await apuntarResultado(api, torneo.id, partido(torneo, 1, 2), P[1]!); // 2-3: gana la 2
  let ahora = await consultar(api, torneo.id);
  assert.deepEqual([ahora.estado, ahora.campeona], ["en_juego", null], "antes de la final");
  await apuntarResultado(api, torneo.id, partido(ahora, 2, 1), P[1]!, "6-3 6-4"); // la final, 4-2: gana la 2
  ahora = await consultar(api, torneo.id);
  assert.deepEqual([ahora.estado, id(ahora.campeona)], ["terminado", P[1]], "después de la final");
});
