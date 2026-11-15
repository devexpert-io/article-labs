// Tests ocultos de la spec `torneos`: el cuadro, la primera ronda (C13) y las siguientes (C14).
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en test-ocultos/
// dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test. Cada prueba arranca su propia API.
// Cada partido se busca por su ronda y su número, y cada pareja, por el id de su inscripción (P[0] es la pareja 1).
// Los torneos tienen sitio de sobra (tres pistas y todas las franjas de uno o dos días): el calendario se prueba en C15.
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

/** Lo que fija C13 de un partido de la primera ronda. */
function dePrimeraRonda(p: any) {
  const { numero, parejas, estado, ganadora, marcador } = vista(p);
  return { numero, parejas, estado, ganadora, marcador };
}

function jugable(numero: number, a: string, b: string) {
  return { numero, parejas: [a, b], estado: "pendiente", ganadora: null, marcador: null };
}

function descanso(numero: number, a: string) {
  return { numero, parejas: [a, null], estado: "descanso", ganadora: a, marcador: null };
}

function primeraRonda(torneo: any) {
  return rondaDe(torneo, 1).map(dePrimeraRonda);
}

/** Las parejas de cada partido de una ronda, por número. */
function parejasDeLaRonda(torneo: any, ronda: number) {
  return rondaDe(torneo, ronda).map(parejasDe);
}

prueba("C13 · con 8 parejas, la primera ronda es 1-8, 2-7, 3-6 y 4-5, por orden de inscripción", async (api) => {
  const { torneo, parejas: P } = await torneoCerrado(api, 8);
  assert.deepEqual(primeraRonda(torneo), [jugable(1, P[0]!, P[7]!), jugable(2, P[1]!, P[6]!), jugable(3, P[2]!, P[5]!), jugable(4, P[3]!, P[4]!)]);
});

prueba("C13 · con 5 parejas, T es 8: las parejas 1, 2 y 3 descansan y la 4 juega contra la 5 (el ejemplo de la spec)", async (api) => {
  const { torneo, parejas: P } = await torneoCerrado(api, 5);
  assert.deepEqual(primeraRonda(torneo), [descanso(1, P[0]!), descanso(2, P[1]!), descanso(3, P[2]!), jugable(4, P[3]!, P[4]!)]);
});

prueba("C13 · con 2, 3, 4, 6 y 7 parejas, el partido i lo juegan la pareja i y la T+1−i, y si esa no existe, la pareja i descansa", async () => {
  const casos: [number, (P: string[]) => unknown[]][] = [
    [2, (P) => [jugable(1, P[0]!, P[1]!)]],
    [3, (P) => [descanso(1, P[0]!), jugable(2, P[1]!, P[2]!)]],
    [4, (P) => [jugable(1, P[0]!, P[3]!), jugable(2, P[1]!, P[2]!)]],
    [6, (P) => [descanso(1, P[0]!), descanso(2, P[1]!), jugable(3, P[2]!, P[5]!), jugable(4, P[3]!, P[4]!)]],
    [7, (P) => [descanso(1, P[0]!), jugable(2, P[1]!, P[6]!), jugable(3, P[2]!, P[5]!), jugable(4, P[3]!, P[4]!)]],
  ];
  // Cada torneo en su propia API, para que no compartan socios.
  for (const [n, esperado] of casos) {
    await conApiNueva(async (api) => {
      const { torneo, parejas } = await torneoCerrado(api, n);
      assert.deepEqual(primeraRonda(torneo), esperado(parejas), `con ${n} parejas`);
    });
  }
});

prueba("C13 · con 9 parejas, T es 16: de la 1 a la 7 descansan y la 8 juega contra la 9", async (api) => {
  const { torneo, parejas: P } = await torneoCerrado(api, 9);
  assert.deepEqual(primeraRonda(torneo), [1, 2, 3, 4, 5, 6, 7].map((i) => descanso(i, P[i - 1]!)).concat([jugable(8, P[7]!, P[8]!)]));
});

prueba("C13 · con 16 parejas, T es 16 y no hay descansos: 1-16, 2-15, ..., 8-9", async (api) => {
  const { torneo, parejas: P } = await torneoCerrado(api, 16);
  assert.deepEqual(primeraRonda(torneo), [1, 2, 3, 4, 5, 6, 7, 8].map((i) => jugable(i, P[i - 1]!, P[16 - i]!)));
});

prueba("C13 · juegan solo las inscripciones inscritas, numeradas por su orden de inscripción", async (api) => {
  const socios = await sociosAlDia(api, 12);
  const t = await crearTorneo(api, { pistas: ["pista-1", "pista-2", "pista-3"], franjas: franjasDe(SABADO) });
  const [a, b, c, d, e, f] = await inscribirParejas(api, t.id, socios, 6);
  esExito(await darDeBaja(api, t.id, b), "dar de baja la segunda:");
  esExito(await darDeBaja(api, t.id, e), "dar de baja la quinta:");
  // Los socios de la segunda vuelven a inscribirse: su nueva inscripción es la última.
  const g = await inscribirPareja(api, t.id, [socios[3]!, socios[2]!]);
  const torneo = await cerrarYConsultar(api, t.id);
  // Juegan a, c, d, f y g: son las parejas 1 a 5.
  assert.deepEqual(primeraRonda(torneo), [descanso(1, a!), descanso(2, c!), descanso(3, d!), jugable(4, f!, g)]);
  const enElCuadro = torneo.partidos.flatMap((p: any) => parejasDe(p));
  for (const baja of [b, e]) assert.ok(!enElCuadro.includes(baja), `la inscripción ${baja}, de baja, no está en el cuadro`);
});

prueba("C14 · al cerrar se crean todos los partidos de todas las rondas, cada ronda con la mitad que la anterior hasta la final, con null en las parejas que no se saben", async () => {
  const casos: [number, number[]][] = [[2, [1]], [4, [2, 1]], [8, [4, 2, 1]], [16, [8, 4, 2, 1]]];
  // Cada torneo en su propia API, para que no compartan socios. Sin descansos, al cerrar no se sabe ninguna pareja de la ronda 2 en adelante.
  for (const [n, porRonda] of casos) {
    await conApiNueva(async (api) => {
      const { torneo } = await torneoCerrado(api, n);
      assert.equal(torneo.partidos.length, porRonda.reduce((x, y) => x + y, 0), `con ${n} parejas, número de partidos`);
      for (const [i, cuantos] of porRonda.entries()) {
        assert.deepEqual(rondaDe(torneo, i + 1).map((p) => p.numero), Array.from({ length: cuantos }, (_, k) => k + 1), `con ${n} parejas, los números de la ronda ${i + 1}`);
      }
      for (const p of torneo.partidos.filter((x: any) => x.ronda > 1)) {
        const { parejas, estado, ganadora, marcador } = vista(p);
        assert.deepEqual({ parejas, estado, ganadora, marcador }, { parejas: [null, null], estado: "pendiente", ganadora: null, marcador: null }, `con ${n} parejas, el partido ${p.numero} de la ronda ${p.ronda}`);
      }
    });
  }
});

prueba("C14 · con 5 parejas, la segunda ronda es 1 contra la ganadora de 4 y 5, y 2 contra 3, y la final espera a las dos (el ejemplo de la spec)", async (api) => {
  const { torneo, parejas: P } = await torneoCerrado(api, 5);
  assert.deepEqual(rondaDe(torneo, 2).map((p) => vista(p)).map(({ numero, parejas, estado, ganadora }) => ({ numero, parejas, estado, ganadora })), [
    { numero: 1, parejas: [P[0], null], estado: "pendiente", ganadora: null },
    { numero: 2, parejas: [P[1], P[2]], estado: "pendiente", ganadora: null },
  ]);
  assert.deepEqual(parejasDeLaRonda(torneo, 3), [[null, null]], "la final");
  assert.equal(torneo.partidos.length, 7, "4 partidos en la primera ronda (3 descansos), 2 en la segunda y la final");
  // Cuando gana la pareja 5, ocupa el segundo sitio del partido 1 de la segunda ronda.
  await reloj(api, DESPUES);
  await apuntarResultado(api, torneo.id, partido(torneo, 1, 4), P[4]!);
  assert.deepEqual(parejasDe(partido(await consultar(api, torneo.id), 2, 1)), [P[0], P[4]]);
});

prueba("C14 · con 9 parejas, el partido j de la segunda ronda lo juegan la ganadora del j y la del M+1−j: 1 contra la ganadora de 8 y 9, 2-7, 3-6 y 4-5", async (api) => {
  const { torneo, parejas: P } = await torneoCerrado(api, 9);
  assert.deepEqual(parejasDeLaRonda(torneo, 2), [[P[0], null], [P[1], P[6]], [P[2], P[5]], [P[3], P[4]]]);
  assert.deepEqual(parejasDeLaRonda(torneo, 3), [[null, null], [null, null]]);
  assert.deepEqual(parejasDeLaRonda(torneo, 4), [[null, null]]);
});

prueba("C14 · con 8 parejas, cada ganadora ocupa su sitio: el partido j de la ronda siguiente lo juegan la ganadora del j y la del M+1−j, en ese orden", async (api) => {
  const { torneo, parejas: P } = await torneoCerrado(api, 8);
  await reloj(api, DESPUES);
  // Primera ronda: 1-8, 2-7, 3-6 y 4-5. Se apuntan en desorden, y ganan la 4, la 8, la 6 y la 2.
  for (const [numero, ganadora] of [[4, P[3]], [1, P[7]], [3, P[5]], [2, P[1]]] as [number, string][]) {
    await apuntarResultado(api, torneo.id, partido(torneo, 1, numero), ganadora);
  }
  const semifinales = await consultar(api, torneo.id);
  assert.deepEqual(parejasDeLaRonda(semifinales, 2), [[P[7], P[3]], [P[1], P[5]]], "semifinales: 8 contra 4 y 2 contra 6");
  // Se apunta antes la segunda semifinal: gana la 6. Y en la primera gana la 4.
  await apuntarResultado(api, torneo.id, partido(semifinales, 2, 2), P[5]!);
  await apuntarResultado(api, torneo.id, partido(semifinales, 2, 1), P[3]!);
  assert.deepEqual(parejasDeLaRonda(await consultar(api, torneo.id), 3), [[P[3], P[5]]], "la final: 4 contra 6");
});
