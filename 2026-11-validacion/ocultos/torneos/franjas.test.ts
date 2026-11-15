// Tests ocultos de la spec `torneos`: las franjas que bloquea un torneo (C6) y las que libera al cerrar (C17).
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en test-ocultos/
// dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test. Cada prueba arranca su propia API.
// Las combinaciones que tienen partido se leen de los partidos del torneo: cuáles son exactamente se prueba en C15.
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

/** El estado y el torneoId de cada franja de un día, por pista: { "pista-1": { "09:00": ["libre", null], ... }, ... }. */
async function estadosDelDia(api: Api, fecha: string, pistaId?: string): Promise<Record<string, Record<string, [unknown, string | null]>>> {
  const r = await api.pedir("GET", `/api/disponibilidad?fecha=${fecha}${pistaId ? `&pista=${pistaId}` : ""}`);
  assert.equal(r.status, 200, `disponibilidad del ${fecha}: ${r.texto.slice(0, 500)}`);
  const salida: Record<string, Record<string, [unknown, string | null]>> = {};
  for (const p of r.cuerpo.pistas) {
    salida[p.pistaId] = Object.fromEntries(p.franjas.map((f: any) => [f.inicio.slice(11), [f.estado, id(f.torneoId)]]));
  }
  return salida;
}

/** Lo esperado en un día sin reservas: libres, salvo la pista 4 (cerrada), con los cambios que se pidan. */
function diaEsperado(cambios: Record<string, Record<string, [string, string | null]>>, pistas = ["pista-1", "pista-2", "pista-3", "pista-4"]) {
  return Object.fromEntries(pistas.map((pistaId) => [
    pistaId,
    Object.fromEntries(HORAS.map((hora) => [hora, cambios[pistaId]?.[hora] ?? [pistaId === "pista-4" ? "cerrada" : "libre", null]])),
  ]));
}

prueba("C6 · cada franja de un torneo, en cada una de sus pistas, sale en la disponibilidad con estado torneo y su torneoId", async (api) => {
  const t = await crearTorneo(api, { pistas: ["pista-1", "pista-3"], franjas: [`${SABADO}T09:00`, `${SABADO}T12:00`, `${DOMINGO}T18:00`] });
  const otro = await crearTorneo(api, { pistas: ["pista-2"], franjas: [`${SABADO}T12:00`] });
  const deT: [string, string | null] = ["torneo", id(t.id)];
  const deOtro: [string, string | null] = ["torneo", id(otro.id)];
  assert.deepEqual(await estadosDelDia(api, SABADO), diaEsperado({
    "pista-1": { "09:00": deT, "12:00": deT },
    "pista-2": { "12:00": deOtro },
    "pista-3": { "09:00": deT, "12:00": deT },
  }), `el sábado`);
  assert.deepEqual(await estadosDelDia(api, DOMINGO), diaEsperado({ "pista-1": { "18:00": deT }, "pista-3": { "18:00": deT } }), "el domingo");
  assert.deepEqual(await estadosDelDia(api, SABADO, "pista-3"), diaEsperado({ "pista-3": { "09:00": deT, "12:00": deT } }, ["pista-3"]), "con el filtro de pista");
});

prueba("C6 · reservar una franja que bloquea un torneo responde 409 FRANJA_NO_DISPONIBLE; las demás se reservan como siempre", async (api) => {
  const [a, b, c] = await sociosAlDia(api, 3);
  await crearTorneo(api, { pistas: ["pista-1", "pista-3"], franjas: [`${SABADO}T09:00`, `${DOMINGO}T18:00`] });
  for (const pistaId of ["pista-1", "pista-3"]) {
    for (const inicio of [`${SABADO}T09:00`, `${DOMINGO}T18:00`]) {
      esError(await reservar(api, a, pistaId, inicio), 409, "FRANJA_NO_DISPONIBLE", `${pistaId} el ${inicio}:`);
    }
  }
  assert.equal((await api.pedir("GET", `/api/reservas?socio=${a}&desde=2027-01-01`)).cuerpo.total, 0, "no se ha creado ninguna reserva");
  esExito(await reservar(api, b, "pista-2", `${SABADO}T09:00`), "otra pista, a la misma hora:");
  esExito(await reservar(api, c, "pista-1", `${SABADO}T10:30`), "la misma pista, a otra hora:");
});

prueba("C6 · con el torneo en juego, las combinaciones que tienen partido siguen bloqueadas", async (api) => {
  const socios = await sociosAlDia(api, 9);
  const t = await crearTorneo(api, { pistas: ["pista-3", "pista-1"], franjas: [`${SABADO}T09:00`, `${SABADO}T10:30`, `${SABADO}T12:00`] });
  await inscribirParejas(api, t.id, socios, 4);
  const torneo = await cerrarYConsultar(api, t.id);
  const conPartido = combinacionesConPartido(torneo);
  assert.ok(conPartido.size > 0, `los partidos tienen pista y hora: ${JSON.stringify(torneo.partidos)}`);
  for (const combinacion of conPartido) {
    const [pistaId, inicio] = combinacion.split("|") as [string, string];
    const franja = await franjaEn(api, pistaId, inicio);
    assert.deepEqual([franja.estado, id(franja.torneoId)], ["torneo", id(t.id)], `${pistaId} el ${inicio}`);
    esError(await reservar(api, socios[8]!, pistaId, inicio), 409, "FRANJA_NO_DISPONIBLE", `${pistaId} el ${inicio}:`);
  }
});

prueba("C6 · un torneo terminado no está cancelado: las combinaciones de sus partidos siguen saliendo con estado torneo", async (api) => {
  const socios = await sociosAlDia(api, 4);
  const t = await crearTorneo(api, { pistas: ["pista-1", "pista-2"], franjas: [`${SABADO}T09:00`, `${SABADO}T10:30`] });
  const [p1] = await inscribirParejas(api, t.id, socios, 2);
  const final = partido(await cerrarYConsultar(api, t.id), 1, 1);
  assert.ok(typeof final.pistaId === "string" && typeof final.inicio === "string", `la final tiene pista y hora: ${JSON.stringify(final)}`);
  await reloj(api, DESPUES);
  await apuntarResultado(api, t.id, final, p1!);
  const terminado = await consultar(api, t.id);
  assert.equal(terminado.estado, "terminado", "el torneo ha terminado (C21)");
  const franja = await franjaEn(api, final.pistaId, final.inicio);
  assert.deepEqual([franja.estado, id(franja.torneoId)], ["torneo", id(t.id)], `la franja de la final, ${final.pistaId} el ${final.inicio}`);
});

prueba("C17 · al cerrar, las combinaciones de franja y pista sin partido dejan de estar bloqueadas: salen libres y se pueden reservar", async (api) => {
  const socios = await sociosAlDia(api, 14);
  const pistas = ["pista-3", "pista-1"];
  const franjas = [`${SABADO}T09:00`, `${SABADO}T10:30`, `${SABADO}T12:00`];
  const t = await crearTorneo(api, { pistas, franjas });
  await inscribirParejas(api, t.id, socios, 4);
  const torneo = await cerrarYConsultar(api, t.id);
  const conPartido = combinacionesConPartido(torneo);
  // Qué combinaciones les tocan a los partidos se prueba en C15: aquí se leen del torneo.
  assert.ok(conPartido.size > 0 && conPartido.size < 6, `algunas combinaciones tienen partido y otras no: ${JSON.stringify(torneo.partidos)}`);
  let libres = 0;
  for (const pistaId of pistas) {
    for (const inicio of franjas) {
      if (conPartido.has(`${pistaId}|${inicio}`)) continue;
      const franja = await franjaEn(api, pistaId, inicio);
      assert.deepEqual([franja.estado, id(franja.torneoId)], ["libre", null], `${pistaId} el ${inicio} ya no la bloquea el torneo`);
      const r = await reservar(api, socios[8 + libres]!, pistaId, inicio);
      assert.equal(r.status, 201, `reservar ${pistaId} el ${inicio}: ${r.texto}`);
      libres++;
    }
  }
  assert.equal(libres, 6 - conPartido.size, "se han comprobado todas las combinaciones sin partido");
});

prueba("C17 · también se liberan las combinaciones sin partido cuya franja ya había empezado al cerrar", async (api) => {
  const socios = await sociosAlDia(api, 6);
  const pistas = ["pista-1", "pista-2"];
  const franjas = [`${SABADO}T09:00`, `${SABADO}T10:30`, `${SABADO}T12:00`];
  const t = await crearTorneo(api, { pistas, franjas });
  await inscribirParejas(api, t.id, socios, 3);
  await reloj(api, `${SABADO}T09:30`); // la franja de las 09:00 ya ha empezado
  const torneo = await cerrarYConsultar(api, t.id);
  const conPartido = combinacionesConPartido(torneo);
  assert.ok(conPartido.size > 0 && conPartido.size < 6, `algunas combinaciones tienen partido y otras no: ${JSON.stringify(torneo.partidos)}`);
  for (const pistaId of pistas) {
    for (const inicio of franjas) {
      if (conPartido.has(`${pistaId}|${inicio}`)) continue;
      const franja = await franjaEn(api, pistaId, inicio);
      assert.deepEqual([franja.estado, id(franja.torneoId)], ["libre", null], `${pistaId} el ${inicio} ya no la bloquea el torneo`);
    }
  }
});

prueba("C17 · otro torneo puede usar las combinaciones que quedan libres al cerrar", async (api) => {
  const socios = await sociosAlDia(api, 4);
  const franjas = [`${SABADO}T09:00`, `${SABADO}T10:30`];
  const t = await crearTorneo(api, { pistas: ["pista-1"], franjas });
  await inscribirParejas(api, t.id, socios, 2);
  const conPartido = combinacionesConPartido(await cerrarYConsultar(api, t.id));
  const sobrante = franjas.find((inicio) => !conPartido.has(`pista-1|${inicio}`));
  assert.ok(sobrante, `la final deja libre una de las dos franjas: ${JSON.stringify([...conPartido])}`);
  esExito(await pedirTorneo(api, datosTorneo({ pistas: ["pista-1"], franjas: [sobrante] })), `otro torneo en pista-1 el ${sobrante}:`);
});
