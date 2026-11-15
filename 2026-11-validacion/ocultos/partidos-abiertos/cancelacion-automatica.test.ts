// Tests ocultos de la spec `partidos-abiertos`: el partido se cancela solo (C16).
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en test-ocultos/
// dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test. Cada prueba arranca su propia API.
// La cancelación automática se comprueba solo por la API (GET /api/partidos/:id, GET /api/partidos, GET /api/reservas/:id,
// GET /api/reservas y GET /api/disponibilidad), nunca en /_estado: una implementación puede calcularla al leer.
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

/** Martes 5 de enero a las 18:00, en la pista 1: punta, 700 por jugador. Faltan 32 horas desde ENERO y 6 a las 12:00. */
const PARTIDO = { pistaId: "pista-1", inicio: "2027-01-05T18:00" };

interface Seguido {
  partido: any;
  organizador: string;
  pistaId: string;
  inicio: string;
  reservaId: unknown;
}

/** Crea un partido y apunta el id de su reserva (buscada por organizador, pista y hora) para seguirlo por la API. */
async function seguir(api: Api, organizador: string, franja: { pistaId: string; inicio: string }): Promise<Seguido> {
  const partido = await crearPartido(api, organizador, franja);
  const reserva = await reservaEn(api, organizador, franja.pistaId, franja.inicio);
  return { partido, organizador, pistaId: franja.pistaId, inicio: franja.inicio, reservaId: reserva.id };
}

/** Por la API, el partido sigue en pie: con ese estado, su reserva confirmada y su franja reservada. */
async function sigueEnPie(api: Api, s: Seguido, estado: string, contexto: string) {
  const visto = await verPartido(api, s.partido);
  assert.equal(visto.estado, estado, `${contexto} el partido: ${JSON.stringify(visto)}`);
  const reserva = await verReserva(api, s.reservaId);
  assert.equal(reserva.estado, "confirmada", `${contexto} su reserva: ${JSON.stringify(reserva)}`);
  assert.equal(await estadoFranja(api, s.pistaId, s.inicio), "reservada", `${contexto} su franja`);
}

/**
 * Por la API, el partido se ha cancelado solo: cancelado con motivo incompleto y fuera de GET /api/partidos, con su reserva
 * cancelada sin penalización (en GET /api/reservas/:id y en GET /api/reservas) y su franja libre.
 */
async function canceladoSolo(api: Api, s: Seguido, contexto: string) {
  const visto = await verPartido(api, s.partido);
  assert.deepEqual([visto.estado, visto.motivo], ["cancelado", "incompleto"], `${contexto} el partido: ${JSON.stringify(visto)}`);
  for (const consulta of ["", `?fecha=${s.inicio.slice(0, 10)}`]) {
    const ids = idsDe(await partidosConPlazas(api, consulta));
    assert.ok(!ids.includes(String(s.partido.id)), `${contexto} no sale en GET /api/partidos${consulta}: ${ids.join(", ")}`);
  }
  const reserva = await verReserva(api, s.reservaId);
  assert.equal(reserva.estado, "cancelada", `${contexto} su reserva: ${JSON.stringify(reserva)}`);
  sinPenalizacion(reserva);
  const enLista = await reservaEn(api, s.organizador, s.pistaId, s.inicio);
  assert.equal(enLista.estado, "cancelada", `${contexto} su reserva en GET /api/reservas: ${JSON.stringify(enLista)}`);
  sinPenalizacion(enLista);
  assert.equal(await estadoFranja(api, s.pistaId, s.inicio), "libre", `${contexto} su franja`);
}

prueba("C16 · un partido que no está completo cuando faltan 6 horas o menos se cancela solo: cancelado con motivo incompleto, su reserva cancelada y su franja libre", async (api) => {
  const [organizador, a] = await sociosAlDia(api, 2);
  const s = await seguir(api, organizador, PARTIDO);
  await unir(api, s.partido, a);
  await reloj(api, "2027-01-05T11:59"); // faltan 6 h 1 min
  await sigueEnPie(api, s, "abierto", "a 6 h 1 min:");
  await reloj(api, "2027-01-05T12:01"); // faltan 5 h 59 min
  await canceladoSolo(api, s, "a 5 h 59 min:");
  assert.deepEqual(penalizacionesDe(await verPartido(api, s.partido)), [], "sin penalización para nadie");
  await reloj(api, "2027-01-05T19:00"); // ya ha empezado
  await canceladoSolo(api, s, "después de empezar:");
});

prueba("C16 · a 6 horas justas ya se cancela solo", async (api) => {
  const [organizador] = await sociosAlDia(api, 1);
  const s = await seguir(api, organizador, PARTIDO);
  await reloj(api, "2027-01-05T12:00");
  await canceladoSolo(api, s, "a 6 horas justas:");
});

prueba("C16 · se cancela solo aunque el reloj salte de golpe hasta menos de 6 horas o hasta después de empezar", async (api) => {
  const [o1, o2] = await sociosAlDia(api, 2);
  const tarde = await seguir(api, o1, PARTIDO);
  const noche = await seguir(api, o2, { pistaId: "pista-2", inicio: "2027-01-05T21:00" });
  await reloj(api, "2027-01-05T19:00"); // el de las 18:00 empezó hace una hora y al de las 21:00 le faltan 2
  await canceladoSolo(api, tarde, "el que ya ha empezado:");
  await canceladoSolo(api, noche, "al que le faltan 2 horas:");
});

prueba("C16 · un partido completo no se cancela solo, aunque falten menos de 6 horas o ya haya empezado", async (api) => {
  const [organizador, a, b, c] = await sociosAlDia(api, 4);
  const s = await seguir(api, organizador, PARTIDO);
  await unir(api, s.partido, a, b, c);
  for (const ahora of ["2027-01-05T12:00", "2027-01-05T17:30", "2027-01-05T18:30"]) {
    await reloj(api, ahora);
    await sigueEnPie(api, s, "completo", `a las ${ahora}:`);
  }
});

prueba("C16 · si deja de estar completo cuando ya faltan 6 horas o menos, se cancela solo", async (api) => {
  const [organizador, a, b, c] = await sociosAlDia(api, 4);
  const s = await seguir(api, organizador, PARTIDO);
  await unir(api, s.partido, a, b, c);
  await reloj(api, "2027-01-05T13:00"); // faltan 5 horas
  const importe = (await verPartido(api, s.partido)).importePorJugador;
  const suParte = Number.isInteger(importe) ? importe : 700; // que sea la cuarta parte es de C7
  const r = await salir(api, s.partido, b, { forzar: true });
  esOk(r, "con forzar se puede salir:");
  await canceladoSolo(api, s, "tras la salida:");
  // Nadie más paga nada. La spec no dice si a quien ha salido tarde se le perdona su parte: vale con ella o sin ella.
  const penalizaciones = penalizacionesDe(await verPartido(api, s.partido));
  const valen = penalizaciones.length === 0 || (penalizaciones.length === 1 && penalizaciones[0]![0] === b && penalizaciones[0]![1] === suParte);
  assert.ok(valen, `como mucho paga su parte quien ha salido: ${JSON.stringify(penalizaciones)}`);
});

prueba("C16 · un partido solo se puede crear si faltan más de 6 horas para su franja: si no, 409 DEMASIADO_TARDE", async (api) => {
  const [organizador] = await sociosAlDia(api, 1);
  const antes = await totalReservas(api);
  // El reloj está en el lunes 4 de enero a las 10:00.
  esError(await pedirPartido(api, organizador, { pistaId: "pista-1", inicio: "2027-01-04T15:00" }), 409, "DEMASIADO_TARDE", "a 5 horas:");
  esError(await pedirPartido(api, organizador, { pistaId: "pista-1", inicio: "2027-01-04T10:30" }), 409, "DEMASIADO_TARDE", "a media hora:");
  assert.equal(await totalReservas(api), antes, "no se reserva nada");
  await reloj(api, "2027-01-04T10:29");
  await crearPartido(api, organizador, { pistaId: "pista-1", inicio: "2027-01-04T16:30" }); // faltan 6 h 1 min
  await reloj(api, "2027-01-04T10:30");
  esError(await pedirPartido(api, organizador, { pistaId: "pista-2", inicio: "2027-01-04T16:30" }), 409, "DEMASIADO_TARDE", "a 6 horas justas:");
  assert.equal(await totalReservas(api), antes + 1, "solo se ha reservado el de las 6 h 1 min");
});

prueba("C16 · cuando se cancela solo, su franja se puede reservar y el partido ya no admite a nadie ni se puede cancelar", async (api) => {
  const [organizador, a, b, otro] = await sociosAlDia(api, 4);
  const s = await seguir(api, organizador, PARTIDO);
  await unir(api, s.partido, a);
  await reloj(api, "2027-01-05T13:00"); // faltan 5 horas
  esError(await unirse(api, s.partido, b), 409, "PARTIDO_CANCELADO", "unirse:");
  esError(await cancelar(api, s.partido, organizador, { forzar: true }), 409, "PARTIDO_CANCELADO", "cancelarlo:");
  const nueva = await pedirReserva(api, otro, PARTIDO.pistaId, PARTIDO.inicio);
  esOk(nueva, "la franja se puede reservar:");
});
