// Tests ocultos de la spec `partidos-abiertos`: crear un partido, con las reglas de siempre (C3) y con rango de nivel (C4).
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en test-ocultos/
// dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test. Cada prueba arranca su propia API.
// Cada caso tiene un solo dato mal y los demás bien: la spec no fija qué error gana cuando fallan varios. En los rangos mal
// formados, el organizador tiene un nivel que cae dentro de lo que se pide, para que el único error posible sea el 400. La
// excepción es nivelMin mayor que nivelMax, donde ningún nivel cae dentro: ahí se exige el 400 que fija la spec para ese caso.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

// ---- Ayudas comunes: son las mismas en todos los ficheros, porque el corrector solo copia ayuda.ts y los *.test.ts ----

const GESTOR = "socio-040";
/** Lunes 4 de enero de 2027 a las 10:00: nadie tiene reservas futuras y las franjas de las pistas operativas están libres. */
const ENERO = "2027-01-04T10:00";

const abiertas = new Set<Api>();
after(() => abiertas.forEach((api) => api.cerrar()));

/**
 * Cada prueba arranca su propia API, así que no depende del orden ni de lo que cambien las demás. Por defecto, con el reloj
 * del club en ENERO y en UTC, para que la zona horaria del sistema no influya (en enero y febrero no hay cambios de hora).
 */
function prueba(nombre: string, cuerpo: (api: Api) => Promise<void>, entorno: Record<string, string> = {}) {
  test(nombre, { timeout: 30_000 }, async () => {
    const api = await arrancarApi({ AHORA: ENERO, TZ: "UTC", ...entorno });
    abiertas.add(api);
    try {
      await cuerpo(api);
    } finally {
      api.cerrar();
      abiertas.delete(api);
    }
  });
}

function esError(r: Respuesta, http: number, codigo: string, contexto = "") {
  assert.equal(r.status, http, `${contexto} esperaba ${http} ${codigo} y llegó ${r.status}: ${r.texto}`);
  assert.equal(r.cuerpo?.error?.codigo, codigo, `${contexto} ${r.texto}`);
}

/** Cuando la spec admite más de un error, vale cualquiera de la lista. */
function esUnoDe(r: Respuesta, posibles: [number, string][], contexto = "") {
  const vale = posibles.some(([http, codigo]) => r.status === http && r.cuerpo?.error?.codigo === codigo);
  const esperados = posibles.map(([http, codigo]) => `${http} ${codigo}`).join(" o ");
  assert.ok(vale, `${contexto} esperaba ${esperados} y llegó ${r.status}: ${r.texto}`);
}

/** Si una operación ha salido bien: cualquier 2xx (el código exacto de cada respuesta se prueba en su criterio). */
function salioBien(r: Respuesta): boolean {
  return r.status >= 200 && r.status < 300;
}

function esOk(r: Respuesta, contexto = "") {
  assert.ok(salioBien(r), `${contexto} esperaba que saliera bien y llegó ${r.status}: ${r.texto}`);
}

async function reloj(api: Api, ahora: string) {
  const r = await api.pedir("POST", "/_reloj", { cuerpo: { ahora } });
  assert.equal(r.status, 200, `mover el reloj a ${ahora}: ${r.texto}`);
}

/** Socios de la semilla con rol socio y la cuota al día. En 2027 ninguno tiene reservas futuras, y en la semilla ninguno tiene nivel. */
async function sociosAlDia(api: Api, cuantos: number): Promise<string[]> {
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  const ids: string[] = estado.socios.filter((s: any) => s.rol === "socio" && s.cuotaActiva === true).map((s: any) => s.id);
  assert.ok(ids.length >= cuantos, `hacen falta ${cuantos} socios con la cuota al día y hay ${ids.length}`);
  return ids.slice(0, cuantos);
}

/** Un socio de la semilla sin la cuota al día. */
async function socioSinCuota(api: Api): Promise<string> {
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  const moroso = estado.socios.find((s: any) => s.rol === "socio" && s.cuotaActiva === false);
  assert.ok(moroso, "la semilla tiene socios sin la cuota al día");
  return moroso.id;
}

/** Pide fijar el nivel de un socio como `quien` (con null, sin cabecera X-Socio). */
function pedirNivel(api: Api, socioId: string, nivel: unknown, quien: string | null) {
  return api.pedir("PATCH", `/api/socios/${encodeURIComponent(socioId)}`, { cuerpo: { nivel }, socio: quien ?? undefined });
}

/** Fija el nivel de un socio como el propio socio (que PATCH /api/socios/:id funciona se prueba en C2). */
async function fijarNivel(api: Api, socioId: string, nivel: number | null) {
  const r = await pedirNivel(api, socioId, nivel, socioId);
  assert.ok(salioBien(r), `fijar el nivel ${nivel} de ${socioId}: ${r.status} ${r.texto}`);
}

/** El socio tal como sale en GET /api/socios, buscado por su id. */
async function socioEnLista(api: Api, id: string): Promise<any> {
  const r = await api.pedir("GET", `/api/socios?texto=${encodeURIComponent(id)}`);
  assert.equal(r.status, 200, `GET /api/socios?texto=${id}: ${r.texto}`);
  return r.cuerpo.socios.find((s: any) => s.id === id);
}

function rutaPartido(partido: { id: unknown }): string {
  return `/api/partidos/${encodeURIComponent(String(partido.id))}`;
}

/** Pide crear un partido como `organizador` (con null, sin cabecera X-Socio). */
function pedirPartido(api: Api, organizador: string | null, cuerpo: Record<string, unknown>) {
  return api.pedir("POST", "/api/partidos", { cuerpo, socio: organizador ?? undefined });
}

/** Crea un partido y devuelve el de la respuesta (el 201 y la forma exacta de la respuesta se prueban en C6). */
async function crearPartido(api: Api, organizador: string, cuerpo: Record<string, unknown>): Promise<any> {
  const r = await pedirPartido(api, organizador, cuerpo);
  assert.ok(salioBien(r), `crear el partido ${JSON.stringify(cuerpo)} como ${organizador}: ${r.status} ${r.texto}`);
  const partido = r.cuerpo?.partido ?? r.cuerpo;
  assert.ok(partido?.id !== undefined && partido?.id !== null && partido?.id !== "", `el partido creado no trae id: ${r.texto}`);
  return partido;
}

/** El partido según GET /api/partidos/:id (que responde { partido } se prueba en C6). */
async function verPartido(api: Api, partido: { id: unknown }): Promise<any> {
  const r = await api.pedir("GET", rutaPartido(partido));
  assert.equal(r.status, 200, `GET ${rutaPartido(partido)}: ${r.texto}`);
  return r.cuerpo?.partido ?? r.cuerpo;
}

/** `socio` pide unirse al partido (sin `socio`, sin cabecera X-Socio). */
function unirse(api: Api, partido: { id: unknown }, socio?: string) {
  return api.pedir("POST", `${rutaPartido(partido)}/unirse`, { socio });
}

/** Une a los socios al partido, por este orden (que unirse funciona se prueba en C8). */
async function unir(api: Api, partido: { id: unknown }, ...socios: string[]) {
  for (const socio of socios) {
    const r = await unirse(api, partido, socio);
    assert.ok(salioBien(r), `${socio} se une al partido ${partido.id}: ${r.status} ${r.texto}`);
  }
}

/** `socio` pide salir del partido (sin `socio`, sin cabecera X-Socio). */
function salir(api: Api, partido: { id: unknown }, socio?: string, cuerpo: Record<string, unknown> = {}) {
  return api.pedir("POST", `${rutaPartido(partido)}/salir`, { cuerpo, socio });
}

/** `socio` pide cancelar el partido (sin `socio`, sin cabecera X-Socio). */
function cancelar(api: Api, partido: { id: unknown }, socio?: string, cuerpo: Record<string, unknown> = {}) {
  return api.pedir("POST", `${rutaPartido(partido)}/cancelar`, { cuerpo, socio });
}

/** La lista de GET /api/partidos con esa consulta (que la respuesta es { partidos } se prueba en C18). */
async function partidosConPlazas(api: Api, consulta = ""): Promise<any[]> {
  const r = await api.pedir("GET", `/api/partidos${consulta}`);
  assert.equal(r.status, 200, `GET /api/partidos${consulta}: ${r.texto}`);
  const lista = Array.isArray(r.cuerpo) ? r.cuerpo : r.cuerpo?.partidos;
  assert.ok(Array.isArray(lista), `GET /api/partidos${consulta} no trae la lista de partidos: ${r.texto}`);
  return lista;
}

/** Los ids de una lista de partidos, como texto (la spec no fija su formato). */
function idsDe(partidos: { id: unknown }[]): string[] {
  return partidos.map((p) => String(p.id));
}

/** Una reserva normal, con la X-Socio del propio socio (que sin ella también se puede reservar se prueba en C20). */
function pedirReserva(api: Api, socioId: string, pistaId: string, inicio: string) {
  return api.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio }, socio: socioId });
}

/** Una reserva normal, para preparar (que reservar funciona igual que antes se prueba en C20). */
async function reservar(api: Api, socioId: string, pistaId: string, inicio: string): Promise<any> {
  const r = await pedirReserva(api, socioId, pistaId, inicio);
  assert.ok(salioBien(r) && r.cuerpo?.reserva, `reservar ${pistaId} ${inicio} para ${socioId}: ${r.status} ${r.texto}`);
  return r.cuerpo.reserva;
}

async function verReserva(api: Api, id: unknown): Promise<any> {
  const r = await api.pedir("GET", `/api/reservas/${encodeURIComponent(String(id))}`);
  assert.equal(r.status, 200, `GET /api/reservas/${id}: ${r.texto}`);
  return r.cuerpo.reserva;
}

/** La reserva de `socioId` en esa pista y a esa hora, según GET /api/reservas (sin depender del reservaId del partido). */
async function reservaEn(api: Api, socioId: string, pistaId: string, inicio: string): Promise<any> {
  const r = await api.pedir("GET", `/api/reservas?socio=${socioId}&pista=${pistaId}&fecha=${inicio.slice(0, 10)}&limite=100`);
  assert.equal(r.status, 200, `GET /api/reservas de ${socioId}: ${r.texto}`);
  const suyas = r.cuerpo.reservas.filter((x: any) => x.inicio === inicio);
  assert.equal(suyas.length, 1, `esperaba una reserva de ${socioId} en ${pistaId} el ${inicio}: ${r.texto}`);
  return suyas[0];
}

/** El estado de una franja en GET /api/disponibilidad: libre, reservada o cerrada. */
async function estadoFranja(api: Api, pistaId: string, inicio: string): Promise<string> {
  const r = await api.pedir("GET", `/api/disponibilidad?fecha=${inicio.slice(0, 10)}&pista=${pistaId}`);
  assert.equal(r.status, 200, `disponibilidad de ${pistaId} el ${inicio.slice(0, 10)}: ${r.texto}`);
  const franja = r.cuerpo.pistas[0].franjas.find((f: any) => f.inicio === inicio);
  assert.ok(franja, `no está la franja ${pistaId} ${inicio}: ${r.texto}`);
  return franja.estado;
}

/** Cuántas reservas hay en el club, para comprobar que no se ha creado ninguna. */
async function totalReservas(api: Api): Promise<number> {
  const r = await api.pedir("GET", "/api/reservas?limite=1");
  assert.equal(r.status, 200, r.texto);
  return r.cuerpo.total;
}

/** Sin penalización vale tanto sin el campo como con 0. */
function sinPenalizacion(reserva: any) {
  assert.equal(reserva.penalizacion ?? 0, 0, `no debía tener penalización: ${JSON.stringify(reserva)}`);
}

/**
 * Las penalizaciones de un partido como [socioId, importe], ordenadas (la spec no fija el orden ni prohíbe campos extra).
 * Sin el campo cuenta como ninguna: que el partido traiga la lista se prueba en C6.
 */
function penalizacionesDe(partido: any): [string, number][] {
  const original = partido?.penalizaciones ?? [];
  assert.ok(Array.isArray(original), `penalizaciones no es una lista: ${JSON.stringify(partido)}`);
  const lista: [string, number][] = original.map((p: any) => [p?.socioId, p?.importe]);
  return lista.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || Number(a[1]) - Number(b[1]));
}

// ---- Tests ----

/** Miércoles 6 de enero a las 10:30: faltan más de dos días desde ENERO. */
const FRANJA = { pistaId: "pista-1", inicio: "2027-01-06T10:30" };

prueba("C3 · la pista tiene que existir: 404 PISTA_NO_ENCONTRADA y no se reserva nada", async (api) => {
  const [organizador] = await sociosAlDia(api, 1);
  const antes = await totalReservas(api);
  for (const pistaId of ["pista-9", "no-existe"]) {
    esError(await pedirPartido(api, organizador, { pistaId, inicio: FRANJA.inicio }), 404, "PISTA_NO_ENCONTRADA", `pista ${pistaId}:`);
  }
  assert.equal(await totalReservas(api), antes);
});

prueba("C3 · inicio tiene que ser el de una franja: 400 FRANJA_INVALIDA y no se reserva nada", async (api) => {
  const [organizador] = await sociosAlDia(api, 1);
  const antes = await totalReservas(api);
  // Fechas y horas bien formadas que no son el inicio de ninguna franja (empiezan a las 09:00, 10:30, ..., 21:00).
  for (const inicio of ["2027-01-06T10:00", "2027-01-06T09:15", "2027-01-06T22:30", "2027-01-06T08:00"]) {
    esError(await pedirPartido(api, organizador, { pistaId: "pista-1", inicio }), 400, "FRANJA_INVALIDA", `inicio = ${inicio}:`);
  }
  assert.equal(await totalReservas(api), antes);
});

prueba("C3 · el organizador tiene que tener la cuota al día: 409 CUOTA_INACTIVA y no se reserva nada", async (api) => {
  const moroso = await socioSinCuota(api);
  const antes = await totalReservas(api);
  esError(await pedirPartido(api, moroso, FRANJA), 409, "CUOTA_INACTIVA");
  assert.equal(await totalReservas(api), antes);
});

prueba("C3 · la pista no puede estar cerrada: 409 PISTA_CERRADA y no se reserva nada", async (api) => {
  const [organizador] = await sociosAlDia(api, 1);
  const cierre = await api.pedir("PATCH", "/api/pistas/pista-2", { cuerpo: { estado: "cerrada" } });
  assert.equal(cierre.status, 200, cierre.texto);
  const antes = await totalReservas(api);
  esError(await pedirPartido(api, organizador, { pistaId: "pista-4", inicio: FRANJA.inicio }), 409, "PISTA_CERRADA", "la pista 4, cerrada en la semilla:");
  esError(await pedirPartido(api, organizador, { pistaId: "pista-2", inicio: FRANJA.inicio }), 409, "PISTA_CERRADA", "la pista 2, recién cerrada:");
  assert.equal(await totalReservas(api), antes);
});

prueba("C3 · la franja no puede haber empezado: 409 FRANJA_PASADA (o DEMASIADO_TARDE) y no se reserva nada", async (api) => {
  const [organizador] = await sociosAlDia(api, 1);
  const posibles: [number, string][] = [[409, "FRANJA_PASADA"], [409, "DEMASIADO_TARDE"]];
  const antes = await totalReservas(api);
  // El reloj está en el lunes 4 de enero a las 10:00: la de las 09:00 está en juego y las otras dos ya pasaron.
  for (const inicio of ["2027-01-04T09:00", "2027-01-03T19:30", "2026-12-28T10:30"]) {
    esUnoDe(await pedirPartido(api, organizador, { pistaId: "pista-2", inicio }), posibles, `inicio = ${inicio}:`);
  }
  await reloj(api, "2027-01-04T10:30");
  esUnoDe(await pedirPartido(api, organizador, { pistaId: "pista-2", inicio: "2027-01-04T10:30" }), posibles, "la que empieza justo ahora:");
  assert.equal(await totalReservas(api), antes);
});

prueba("C3 · la franja no puede estar ocupada, ni por una reserva normal ni por otro partido: 409 FRANJA_NO_DISPONIBLE", async (api) => {
  const [organizador, otro, organizador2] = await sociosAlDia(api, 3);
  await reservar(api, otro, "pista-1", FRANJA.inicio);
  await crearPartido(api, organizador2, { pistaId: "pista-2", inicio: FRANJA.inicio });
  const antes = await totalReservas(api);
  esError(await pedirPartido(api, organizador, FRANJA), 409, "FRANJA_NO_DISPONIBLE", "con una reserva normal:");
  esError(await pedirPartido(api, organizador, { pistaId: "pista-2", inicio: FRANJA.inicio }), 409, "FRANJA_NO_DISPONIBLE", "con otro partido:");
  assert.equal(await totalReservas(api), antes);
});

prueba("C3 · el organizador no puede pasar del límite de 3 reservas futuras: con 3, 409 LIMITE_DE_RESERVAS; con 2, el partido es la tercera", async (api) => {
  const [lleno, conDos] = await sociosAlDia(api, 2);
  for (const dia of ["05", "06", "07"]) await reservar(api, lleno, "pista-3", `2027-01-${dia}T12:00`);
  for (const dia of ["05", "06"]) await reservar(api, conDos, "pista-2", `2027-01-${dia}T12:00`);
  const antes = await totalReservas(api);
  esError(await pedirPartido(api, lleno, { pistaId: "pista-1", inicio: "2027-01-08T10:30" }), 409, "LIMITE_DE_RESERVAS", "con 3 reservas:");
  assert.equal(await totalReservas(api), antes);
  await crearPartido(api, conDos, { pistaId: "pista-1", inicio: "2027-01-08T10:30" });
});

prueba("C4 · nivelMin y nivelMax van los dos o ninguno: con uno solo, 400 DATOS_INVALIDOS y no se reserva nada", async (api) => {
  const [organizador] = await sociosAlDia(api, 1);
  await fijarNivel(api, organizador, 4);
  const antes = await totalReservas(api);
  esError(await pedirPartido(api, organizador, { ...FRANJA, nivelMin: 3 }), 400, "DATOS_INVALIDOS", "solo nivelMin:");
  esError(await pedirPartido(api, organizador, { ...FRANJA, nivelMax: 5 }), 400, "DATOS_INVALIDOS", "solo nivelMax:");
  assert.equal(await totalReservas(api), antes);
});

prueba("C4 · nivelMin y nivelMax tienen que ser niveles válidos, de 1 a 7 en pasos de 0,5: si no, 400 DATOS_INVALIDOS", async (api) => {
  const [organizador] = await sociosAlDia(api, 1);
  await fijarNivel(api, organizador, 4);
  const antes = await totalReservas(api);
  const rangos: [unknown, unknown][] = [[0.5, 5], [0, 5], [3, 7.5], [3, 8], [3.25, 5], [3, 4.75], ["3", 5], [3, "5"]];
  for (const [nivelMin, nivelMax] of rangos) {
    const caso = `nivelMin = ${JSON.stringify(nivelMin)} y nivelMax = ${JSON.stringify(nivelMax)}:`;
    esError(await pedirPartido(api, organizador, { ...FRANJA, nivelMin, nivelMax }), 400, "DATOS_INVALIDOS", caso);
  }
  assert.equal(await totalReservas(api), antes);
});

prueba("C4 · nivelMin no puede ser mayor que nivelMax: 400 DATOS_INVALIDOS; iguales, sí vale", async (api) => {
  const [organizador] = await sociosAlDia(api, 1);
  await fijarNivel(api, organizador, 4);
  const antes = await totalReservas(api);
  esError(await pedirPartido(api, organizador, { ...FRANJA, nivelMin: 5, nivelMax: 3 }), 400, "DATOS_INVALIDOS", "de 5 a 3:");
  esError(await pedirPartido(api, organizador, { ...FRANJA, nivelMin: 4.5, nivelMax: 4 }), 400, "DATOS_INVALIDOS", "de 4,5 a 4:");
  assert.equal(await totalReservas(api), antes);
  const iguales = await crearPartido(api, organizador, { ...FRANJA, nivelMin: 4, nivelMax: 4 });
  assert.deepEqual([iguales.nivelMin, iguales.nivelMax], [4, 4], JSON.stringify(iguales));
});

prueba("C4 · con rango, el organizador tiene que tener nivel: 409 NIVEL_SIN_DEFINIR y no se reserva nada", async (api) => {
  const [sinNivel, quitado] = await sociosAlDia(api, 2);
  await fijarNivel(api, quitado, 3);
  await fijarNivel(api, quitado, null);
  const antes = await totalReservas(api);
  esError(await pedirPartido(api, sinNivel, { ...FRANJA, nivelMin: 2, nivelMax: 5 }), 409, "NIVEL_SIN_DEFINIR", "sin nivel:");
  esError(await pedirPartido(api, quitado, { ...FRANJA, nivelMin: 1, nivelMax: 7 }), 409, "NIVEL_SIN_DEFINIR", "con el nivel quitado:");
  assert.equal(await totalReservas(api), antes);
});

prueba("C4 · con rango, el organizador tiene que estar dentro, con los extremos incluidos: si no, 409 NIVEL_FUERA_DE_RANGO", async (api) => {
  const [organizador, ...otros] = await sociosAlDia(api, 4);
  for (const socio of [organizador, ...otros]) await fijarNivel(api, socio, 4);
  const antes = await totalReservas(api);
  for (const [nivelMin, nivelMax] of [[4.5, 6], [1, 3.5], [5, 7]]) {
    esError(await pedirPartido(api, organizador, { ...FRANJA, nivelMin, nivelMax }), 409, "NIVEL_FUERA_DE_RANGO", `de ${nivelMin} a ${nivelMax}, con nivel 4:`);
  }
  assert.equal(await totalReservas(api), antes);
  // Dentro, también en los extremos. Cada uno lo organiza un socio con nivel 4, para no llegar al límite de 3 (que es de C11).
  for (const [i, [nivelMin, nivelMax]] of ([[4, 6], [2, 4], [1, 7]] as const).entries()) {
    const r = await pedirPartido(api, otros[i]!, { pistaId: `pista-${i + 1}`, inicio: FRANJA.inicio, nivelMin, nivelMax });
    assert.ok(r.status >= 200 && r.status < 300, `de ${nivelMin} a ${nivelMax}, con nivel 4: ${r.status} ${r.texto}`);
  }
});

prueba("C4 · sin rango, el organizador puede tener nivel o no tenerlo", async (api) => {
  const [sinNivel, conNivel] = await sociosAlDia(api, 2);
  await fijarNivel(api, conNivel, 6.5);
  await crearPartido(api, sinNivel, FRANJA);
  await crearPartido(api, conNivel, { pistaId: "pista-2", inicio: FRANJA.inicio });
});

prueba("C4 · el partido guarda su rango: nivelMin y nivelMax, o null los dos si no tiene", async (api) => {
  const [a, b] = await sociosAlDia(api, 2);
  await fijarNivel(api, b, 3.5);
  const sinRango = await crearPartido(api, a, FRANJA);
  const conRango = await crearPartido(api, b, { pistaId: "pista-2", inicio: "2027-01-07T19:30", nivelMin: 2.5, nivelMax: 4.5 });
  for (const [partido, esperado] of [[sinRango, [null, null]], [conRango, [2.5, 4.5]]] as const) {
    assert.deepEqual([partido.nivelMin, partido.nivelMax], esperado, `al crearlo: ${JSON.stringify(partido)}`);
    const visto = await verPartido(api, partido);
    assert.deepEqual([visto.nivelMin, visto.nivelMax], esperado, `en GET /api/partidos/:id: ${JSON.stringify(visto)}`);
  }
});
