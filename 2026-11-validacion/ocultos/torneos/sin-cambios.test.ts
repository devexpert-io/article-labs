// Tests ocultos de la spec `torneos`: lo demás no cambia (C24). Lo esperado es lo que hace la base `club/`, y estos tests
// tienen que pasar también contra ella: los que tocan torneos no comprueban sus respuestas (en la base esas rutas no existen)
// y solo miran las franjas que no bloquea ningún torneo. De cada reserva y de cada franja se comparan los campos de la base:
// pueden traer otros.
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

/** Hora del club en la semilla: miércoles 18 de noviembre de 2026 a las 10:00. */
const SEMILLA = "2026-11-18T10:00";

function crear(api: Api, cuerpo: Record<string, unknown>, socio?: string) {
  return api.pedir("POST", "/api/reservas", { cuerpo, socio });
}

async function creada(api: Api, cuerpo: Record<string, unknown>, socio?: string): Promise<any> {
  const r = await crear(api, cuerpo, socio);
  assert.equal(r.status, 201, `reservar ${JSON.stringify(cuerpo)}: ${r.texto}`);
  assert.equal(r.cuerpo?.reserva?.estado, "confirmada", r.texto);
  return r.cuerpo.reserva;
}

function cancelarReserva(api: Api, reservaId: string, cuerpo: Record<string, unknown> = {}, socio?: string) {
  return api.pedir("POST", `/api/reservas/${reservaId}/cancelar`, { cuerpo, socio });
}

const campos = (x: any) => ({ socioId: x.socioId, pistaId: x.pistaId, inicio: x.inicio, fin: x.fin, estado: x.estado, importe: x.importe, notas: x.notas });

/** Los campos de la reserva en la base. */
function deLaReserva(r: any) {
  return {
    id: r?.id,
    socioId: r?.socioId,
    pistaId: r?.pistaId,
    inicio: r?.inicio,
    fin: r?.fin,
    estado: r?.estado,
    importe: r?.importe,
    notas: r?.notas,
    penalizacion: r?.penalizacion,
    motivoCancelacion: r?.motivoCancelacion,
  };
}

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Lo que trae GET /api/disponibilidad en la base: cada pista con sus campos y cada franja con inicio, fin, estado y precio. */
function deLaDisponibilidad(cuerpo: any) {
  return {
    fecha: cuerpo?.fecha,
    pistas: (cuerpo?.pistas ?? []).map((p: any) => ({
      pistaId: p?.pistaId,
      nombre: p?.nombre,
      cubierta: p?.cubierta,
      estado: p?.estado,
      franjas: (p?.franjas ?? []).map((f: any) => ({ inicio: f?.inicio, fin: f?.fin, estado: f?.estado, precio: f?.precio })),
    })),
  };
}

function finDe(inicio: string): string {
  const [h, m] = inicio.slice(11).split(":").map(Number);
  const total = h! * 60 + m! + 90;
  return `${inicio.slice(0, 10)}T${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Es punta a partir de las 18:00 y todo el fin de semana. */
function esPunta(inicio: string): boolean {
  const dia = new Date(`${inicio.slice(0, 10)}T12:00:00Z`).getUTCDay();
  return dia === 0 || dia === 6 || inicio.slice(11) >= "18:00";
}

/** La disponibilidad de la base, con el estado de las pistas y las reservas confirmadas de /_estado. */
function disponibilidadEsperada(estado: any, fecha: string, pistaId?: string) {
  return {
    fecha,
    pistas: estado.pistas.filter((p: any) => !pistaId || p.id === pistaId).map((p: any) => ({
      pistaId: p.id,
      nombre: p.nombre,
      cubierta: p.cubierta,
      estado: p.estado,
      franjas: HORAS.map((hora) => {
        const inicio = `${fecha}T${hora}`;
        const reservada = estado.reservas.some((r: any) => r.pistaId === p.id && r.inicio === inicio && r.estado === "confirmada");
        return {
          inicio,
          fin: finDe(inicio),
          estado: p.estado === "cerrada" ? "cerrada" : reservada ? "reservada" : "libre",
          precio: esPunta(inicio) ? p.precioPunta : p.precioValle,
        };
      }),
    })),
  };
}

async function disponibilidad(api: Api, fecha: string) {
  const r = await api.pedir("GET", `/api/disponibilidad?fecha=${fecha}`);
  assert.equal(r.status, 200, `disponibilidad del ${fecha}: ${r.texto.slice(0, 500)}`);
  return deLaDisponibilidad(r.cuerpo);
}

prueba("C24 · reservar funciona igual: 201 con la reserva confirmada, su fin, su precio y sus notas, con X-Socio o sin ella", async (api) => {
  const socios = await sociosAlDia(api, 5);
  const casos = [
    { pistaId: "pista-1", inicio: "2027-01-06T10:30", fin: "2027-01-06T12:00", importe: 1800 }, // miércoles por la mañana: valle
    { pistaId: "pista-2", inicio: "2027-01-07T18:00", fin: "2027-01-07T19:30", importe: 2800, notas: "Traen sus propias palas." }, // desde las 18:00: punta
    { pistaId: "pista-3", inicio: "2027-01-09T09:00", fin: "2027-01-09T10:30", importe: 2000 }, // sábado: punta
    { pistaId: "pista-3", inicio: "2027-01-08T13:30", fin: "2027-01-08T15:00", importe: 1200 }, // viernes a mediodía: valle
    { pistaId: "pista-1", inicio: "2027-01-08T21:00", fin: "2027-01-08T22:30", importe: 2800 }, // última franja
  ];
  for (const [i, caso] of casos.entries()) {
    const socioId = socios[i]!;
    const cuerpo = { socioId, pistaId: caso.pistaId, inicio: caso.inicio, ...(caso.notas ? { notas: caso.notas } : {}) };
    const r = await crear(api, cuerpo, i % 2 === 0 ? socioId : undefined);
    assert.equal(r.status, 201, r.texto);
    const nueva = r.cuerpo.reserva;
    assert.equal(typeof nueva.id, "string");
    const esperado = { socioId, pistaId: caso.pistaId, inicio: caso.inicio, fin: caso.fin, estado: "confirmada", importe: caso.importe, notas: caso.notas ?? "" };
    assert.deepEqual(campos(nueva), esperado);
    const guardada = await api.pedir("GET", `/api/reservas/${nueva.id}`);
    assert.deepEqual(campos(guardada.cuerpo.reserva), esperado);
    const dia = await api.pedir("GET", `/api/disponibilidad?fecha=${caso.inicio.slice(0, 10)}&pista=${caso.pistaId}`);
    assert.equal(dia.cuerpo.pistas[0].franjas.find((f: any) => f.inicio === caso.inicio).estado, "reservada");
  }
});

prueba("C24 · reservar mantiene sus errores", async (api) => {
  const [a, b] = await sociosAlDia(api, 2);
  const [moroso] = await sociosSinCuota(api);
  const franja = { pistaId: "pista-1", inicio: "2027-01-06T10:30" };
  esError(await crear(api, {}), 400, "DATOS_INVALIDOS");
  esError(await crear(api, { ...franja, socioId: a, notas: 7 }), 400, "DATOS_INVALIDOS");
  esError(await crear(api, { ...franja, socioId: "socio-999" }), 404, "SOCIO_NO_ENCONTRADO");
  esError(await crear(api, { ...franja, socioId: a, pistaId: "pista-9" }), 404, "PISTA_NO_ENCONTRADA");
  esError(await crear(api, { ...franja, socioId: a, inicio: "2027-01-06T10:00" }), 400, "FRANJA_INVALIDA");
  esError(await crear(api, { ...franja, socioId: moroso }), 409, "CUOTA_INACTIVA");
  esError(await crear(api, { ...franja, socioId: a, pistaId: "pista-4" }), 409, "PISTA_CERRADA");
  esError(await crear(api, { ...franja, socioId: a, inicio: "2027-01-04T09:00" }), 409, "FRANJA_PASADA");
  await creada(api, { ...franja, socioId: a });
  esError(await crear(api, { ...franja, socioId: b }), 409, "FRANJA_NO_DISPONIBLE");
});

prueba("C24 · el límite de 3 reservas futuras sigue igual: la cuarta da LIMITE_DE_RESERVAS y no cuentan las canceladas ni las que ya han empezado", async (api) => {
  const [socio] = await sociosAlDia(api, 1);
  const en = (dia: string) => ({ socioId: socio, pistaId: "pista-1", inicio: `2027-01-${dia}T10:30` });
  await creada(api, en("05"));
  await creada(api, en("06"));
  const tercera = await creada(api, en("07"));
  esError(await crear(api, en("08")), 409, "LIMITE_DE_RESERVAS", "cuarta:");
  assert.equal((await cancelarReserva(api, tercera.id)).status, 200);
  await creada(api, en("08"));
  esError(await crear(api, en("09")), 409, "LIMITE_DE_RESERVAS", "con una cancelada:");
  await reloj(api, "2027-01-05T11:00"); // la primera ya ha empezado
  await creada(api, en("09"));
  esError(await crear(api, en("10")), 409, "LIMITE_DE_RESERVAS", "con una empezada:");
});

prueba("C24 · con la semilla, Luis Martín tiene 2 reservas futuras: puede hacer una más y la siguiente da LIMITE_DE_RESERVAS", async (api) => {
  const luis = "socio-005";
  const suyas = (await api.pedir("GET", `/api/reservas?socio=${luis}&estado=confirmada&desde=2026-11-18`)).cuerpo.reservas;
  assert.equal(suyas.filter((r: any) => r.inicio > SEMILLA).length, 2);
  await creada(api, { socioId: luis, pistaId: "pista-1", inicio: "2026-11-25T10:30" });
  esError(await crear(api, { socioId: luis, pistaId: "pista-2", inicio: "2026-11-25T10:30" }), 409, "LIMITE_DE_RESERVAS");
}, { AHORA: SEMILLA });

prueba("C24 · con la semilla, la reserva de Marta López del jueves 19 a las 09:00 (faltan 23 horas) solo se cancela con forzar y el 100 % de penalización", async (api) => {
  const delJueves = (await api.pedir("GET", "/api/reservas?socio=socio-002&fecha=2026-11-19")).cuerpo.reservas;
  const marta = delJueves.find((r: any) => r.inicio === "2026-11-19T09:00");
  assert.ok(marta, "Marta López juega el jueves 19 a las 09:00");
  esError(await cancelarReserva(api, marta.id), 409, "FUERA_DE_PLAZO");
  const forzada = await cancelarReserva(api, marta.id, { forzar: true });
  assert.equal(forzada.status, 200, forzada.texto);
  assert.equal(forzada.cuerpo.reserva.estado, "cancelada");
  assert.equal(forzada.cuerpo.reserva.penalizacion, 1200);
}, { AHORA: SEMILLA });

prueba("C24 · cancelar funciona igual: gratis con 24 horas o más; con menos, FUERA_DE_PLAZO sin forzar y el 100 % con forzar; y sus errores", async (api) => {
  const [a, b, c, d] = await sociosAlDia(api, 4);
  const holgada = await creada(api, { socioId: a, pistaId: "pista-1", inicio: "2027-01-08T10:30" });
  const justa = await creada(api, { socioId: b, pistaId: "pista-2", inicio: "2027-01-05T10:30" });
  const tardia = await creada(api, { socioId: c, pistaId: "pista-3", inicio: "2027-01-05T09:00" });
  const empezada = await creada(api, { socioId: d, pistaId: "pista-1", inicio: "2027-01-04T12:00" });

  // Sin X-Socio, y con motivo.
  const libre = await cancelarReserva(api, holgada.id, { motivo: "Se va de viaje" });
  assert.equal(libre.status, 200, libre.texto);
  // Sin penalización vale tanto sin el campo como con 0.
  assert.deepEqual([libre.cuerpo.reserva.estado, libre.cuerpo.reserva.penalizacion ?? 0, libre.cuerpo.reserva.motivoCancelacion], ["cancelada", 0, "Se va de viaje"]);

  await reloj(api, "2027-01-04T10:30");
  // A 24 horas justas, gratis, y con la X-Socio de otro socio: cualquiera puede cancelar.
  const aTiempo = await cancelarReserva(api, justa.id, {}, a);
  assert.equal(aTiempo.status, 200, aTiempo.texto);
  assert.deepEqual([aTiempo.cuerpo.reserva.estado, aTiempo.cuerpo.reserva.penalizacion ?? 0], ["cancelada", 0]);

  esError(await cancelarReserva(api, tardia.id), 409, "FUERA_DE_PLAZO", "22,5 horas antes:");
  esError(await cancelarReserva(api, tardia.id, { forzar: false }), 409, "FUERA_DE_PLAZO", "22,5 horas antes con forzar: false:");
  assert.equal((await api.pedir("GET", `/api/reservas/${tardia.id}`)).cuerpo.reserva.estado, "confirmada");
  const forzada = await cancelarReserva(api, tardia.id, { forzar: true });
  assert.equal(forzada.status, 200, forzada.texto);
  assert.deepEqual([forzada.cuerpo.reserva.estado, forzada.cuerpo.reserva.penalizacion], ["cancelada", tardia.importe]);
  esError(await cancelarReserva(api, tardia.id, { forzar: true }), 409, "YA_CANCELADA");

  await reloj(api, "2027-01-04T12:30");
  esError(await cancelarReserva(api, empezada.id, { forzar: true }), 409, "RESERVA_PASADA");
  esError(await cancelarReserva(api, "R-9999"), 404, "RESERVA_NO_ENCONTRADA");
});

prueba("C24 · consultar reservas funciona igual: filtros, paginación, una reserva por su id y sus errores", async (api) => {
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  // En la base, GET /api/reservas lista en el orden de la semilla: por inicio y, a la misma hora, por pista.
  const todas = [...estado.reservas].sort((a: any, b: any) => comparar(a.inicio, b.inicio) || comparar(a.pistaId, b.pistaId));
  assert.equal(todas.length, 525, "la semilla trae 525 reservas");
  const dia = (r: any) => r.inicio.slice(0, 10);
  const consultas: [string, (r: any) => boolean, number, number][] = [
    ["", () => true, 50, 1],
    ["?pagina=11", () => true, 50, 11],
    ["?pagina=12", () => true, 50, 12],
    ["?fecha=2026-10-15", (r) => dia(r) === "2026-10-15", 50, 1],
    ["?fecha=2026-10-15&desde=2026-10-01&hasta=2026-10-31", (r) => dia(r) === "2026-10-15", 50, 1],
    ["?desde=2026-10-01&hasta=2026-10-31&limite=100&pagina=2", (r) => dia(r) >= "2026-10-01" && dia(r) <= "2026-10-31", 100, 2],
    ["?desde=2026-11-17", (r) => dia(r) >= "2026-11-17", 50, 1],
    ["?hasta=2026-10-02", (r) => dia(r) <= "2026-10-02", 50, 1],
    ["?socio=socio-004&estado=cancelada", (r) => r.socioId === "socio-004" && r.estado === "cancelada", 50, 1],
    ["?pista=pista-4&estado=no_presentada", (r) => r.pistaId === "pista-4" && r.estado === "no_presentada", 50, 1],
    ["?estado=confirmada&limite=7&pagina=3", (r) => r.estado === "confirmada", 7, 3],
    ["?socio=socio-041", (r) => r.socioId === "socio-041", 50, 1],
  ];
  for (const [consulta, filtro, limite, pagina] of consultas) {
    const lista = todas.filter(filtro);
    const esperado = {
      total: lista.length,
      pagina,
      paginas: Math.max(1, Math.ceil(lista.length / limite)),
      reservas: lista.slice((pagina - 1) * limite, pagina * limite).map(deLaReserva),
    };
    for (const socio of [undefined, "socio-003", GESTOR]) {
      const r = await api.pedir("GET", `/api/reservas${consulta}`, { socio });
      assert.equal(r.status, 200, `${consulta}: ${r.texto.slice(0, 300)}`);
      const { total, pagina: p, paginas, reservas } = r.cuerpo;
      assert.deepEqual({ total, pagina: p, paginas, reservas: reservas.map(deLaReserva) }, esperado, `GET /api/reservas${consulta} con X-Socio ${socio}`);
    }
  }
  const octubre = await api.pedir("GET", "/api/reservas?desde=2026-10-01&hasta=2026-10-31&limite=1");
  assert.equal(octubre.cuerpo.total, 315);

  for (const r of [todas[0], todas.find((x: any) => x.estado === "cancelada"), todas.find((x: any) => x.estado === "no_presentada"), todas.at(-1)]) {
    const una = await api.pedir("GET", `/api/reservas/${r.id}`);
    assert.equal(una.status, 200, una.texto);
    assert.deepEqual(deLaReserva(una.cuerpo.reserva), deLaReserva(r));
  }
  esError(await api.pedir("GET", "/api/reservas/R-9999"), 404, "RESERVA_NO_ENCONTRADA");
  for (const consulta of ["?fecha=2026-10", "?desde=15-10-2026", "?estado=pagada", "?limite=0", "?limite=101", "?limite=abc", "?pagina=0"]) {
    esError(await api.pedir("GET", `/api/reservas${consulta}`), 400, "DATOS_INVALIDOS", `${consulta}:`);
  }
}, { AHORA: SEMILLA });

prueba("C24 · la disponibilidad funciona igual: cada pista con sus nueve franjas, su estado (libre, reservada o cerrada) y su precio, con o sin filtro de pista", async (api) => {
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  // Un jueves y un sábado con reservas, un día del historial y un sábado sin reservas.
  for (const fecha of ["2026-11-19", "2026-11-21", "2026-10-15", "2027-01-09"]) {
    assert.deepEqual(await disponibilidad(api, fecha), disponibilidadEsperada(estado, fecha), `el ${fecha}`);
    for (const pista of estado.pistas) {
      const r = await api.pedir("GET", `/api/disponibilidad?fecha=${fecha}&pista=${pista.id}`);
      assert.equal(r.status, 200, r.texto.slice(0, 300));
      assert.deepEqual(deLaDisponibilidad(r.cuerpo), disponibilidadEsperada(estado, fecha, pista.id), `el ${fecha} en ${pista.id}`);
    }
  }
  const jueves = await disponibilidad(api, "2026-11-19");
  const a1930 = Object.fromEntries(jueves.pistas.map((p: any) => [p.pistaId, p.franjas.find((f: any) => f.inicio.endsWith("19:30")).estado]));
  assert.deepEqual(a1930, { "pista-1": "reservada", "pista-2": "libre", "pista-3": "libre", "pista-4": "cerrada" });
}, { AHORA: SEMILLA });

prueba("C24 · la disponibilidad mantiene sus errores", async (api) => {
  for (const consulta of ["", "?fecha=2027-01", "?fecha=09-01-2027", "?pista=pista-1"]) {
    esError(await api.pedir("GET", `/api/disponibilidad${consulta}`), 400, "DATOS_INVALIDOS", `${consulta}:`);
  }
  esError(await api.pedir("GET", "/api/disponibilidad?fecha=2027-01-09&pista=pista-9"), 404, "PISTA_NO_ENCONTRADA");
});

prueba("C24 · crear, cerrar y cancelar torneos no cambia la disponibilidad de las franjas que no bloquean, ni cómo se reserva y se cancela en ellas", async (api) => {
  const socios = await sociosAlDia(api, 5);
  const dias = [SABADO, DOMINGO];
  const antes: Record<string, any> = {};
  for (const fecha of dias) antes[fecha] = await disponibilidad(api, fecha);
  // Lo que bloquea (o ha bloqueado) algún torneo no se compara: eso se prueba en C6, C17 y C22.
  const delTorneo = new Set([`pista-1|${SABADO}T09:00`, `pista-1|${SABADO}T10:30`, `pista-2|${DOMINGO}T18:00`]);

  // Sin comprobar las respuestas: en la base, estas rutas no existen.
  const creado = await api.pedir("POST", "/api/torneos", { cuerpo: { nombre: "Torneo", pistas: ["pista-1"], franjas: [`${SABADO}T09:00`, `${SABADO}T10:30`], plazas: 4, cuota: 1000 }, socio: GESTOR });
  const torneoId = creado.cuerpo?.torneo?.id;
  if (torneoId !== undefined && torneoId !== null) {
    for (const pareja of [[socios[0], socios[1]], [socios[2], socios[3]]]) {
      await api.pedir("POST", ruta(torneoId, "/inscripciones"), { cuerpo: { socios: pareja }, socio: GESTOR });
    }
    await api.pedir("POST", ruta(torneoId, "/cerrar"), { cuerpo: {}, socio: GESTOR });
  }
  const otro = await api.pedir("POST", "/api/torneos", { cuerpo: { nombre: "Otro", pistas: ["pista-2"], franjas: [`${DOMINGO}T18:00`], plazas: 4, cuota: 0 }, socio: GESTOR });
  const otroId = otro.cuerpo?.torneo?.id;
  if (otroId !== undefined && otroId !== null) await api.pedir("POST", ruta(otroId, "/cancelar"), { cuerpo: {}, socio: GESTOR });

  for (const fecha of dias) {
    const despues = await disponibilidad(api, fecha);
    assert.equal(despues.fecha, antes[fecha].fecha);
    assert.deepEqual(despues.pistas.map((p: any) => p.pistaId), antes[fecha].pistas.map((p: any) => p.pistaId));
    for (const [i, pista] of despues.pistas.entries()) {
      const { franjas: ahora, ...datos } = pista;
      const { franjas: eran, ...datosAntes } = antes[fecha].pistas[i];
      assert.deepEqual(datos, datosAntes, `${pista.pistaId} el ${fecha}`);
      assert.equal(ahora.length, eran.length, `${pista.pistaId} el ${fecha} tiene las mismas franjas`);
      for (const [k, franja] of ahora.entries()) {
        if (delTorneo.has(`${pista.pistaId}|${franja.inicio}`)) continue;
        assert.deepEqual(franja, eran[k], `${pista.pistaId} el ${franja.inicio}`);
      }
    }
  }

  // En una franja que no bloquea ningún torneo se reserva y se cancela como siempre.
  const nueva = await creada(api, { socioId: socios[4], pistaId: "pista-2", inicio: `${SABADO}T09:00` });
  assert.deepEqual(campos(nueva), { socioId: socios[4], pistaId: "pista-2", inicio: `${SABADO}T09:00`, fin: `${SABADO}T10:30`, estado: "confirmada", importe: 2800, notas: "" });
  const franja = async () => (await disponibilidad(api, SABADO)).pistas.find((p: any) => p.pistaId === "pista-2").franjas[0];
  assert.equal((await franja()).estado, "reservada");
  const cancelada = await cancelarReserva(api, nueva.id);
  assert.equal(cancelada.status, 200, cancelada.texto);
  assert.deepEqual([cancelada.cuerpo.reserva.estado, cancelada.cuerpo.reserva.penalizacion ?? 0], ["cancelada", 0]);
  assert.deepEqual(await franja(), antes[SABADO].pistas.find((p: any) => p.pistaId === "pista-2").franjas[0], "la franja vuelve a estar libre");
});
