// Tests ocultos de la spec `partidos-abiertos`: el límite de 3 reservas futuras cuenta los partidos (C11).
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en test-ocultos/
// dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test. Cada prueba arranca su propia API.
// Cuentan las reservas confirmadas que no han empezado (también la del partido que organiza) y los partidos abiertos o
// completos que no han empezado en los que juega sin organizarlos. Cuando una prueba necesita cancelar o salir de un
// partido, que eso funcione es de otro criterio: si no se acepta, la prueba no sigue.
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

/** Un partido abierto de cada organizador, en la pista 1 a las 10:30, un día tras otro desde el miércoles 6 de enero. */
async function partidosDe(api: Api, organizadores: string[]): Promise<any[]> {
  const partidos: any[] = [];
  for (const [i, organizador] of organizadores.entries()) {
    partidos.push(await crearPartido(api, organizador, { pistaId: "pista-1", inicio: `2027-01-${String(6 + i).padStart(2, "0")}T10:30` }));
  }
  return partidos;
}

prueba("C11 · unirse con 3 reservas futuras da 409 LIMITE_DE_RESERVAS; con 2, el partido es la tercera", async (api) => {
  const [organizador, lleno, conDos] = await sociosAlDia(api, 3);
  for (const dia of ["05", "06", "07"]) await reservar(api, lleno, "pista-3", `2027-01-${dia}T12:00`);
  for (const dia of ["05", "06"]) await reservar(api, conDos, "pista-2", `2027-01-${dia}T12:00`);
  const partido = await crearPartido(api, organizador, { pistaId: "pista-1", inicio: "2027-01-08T10:30" });
  esError(await unirse(api, partido, lleno), 409, "LIMITE_DE_RESERVAS", "con 3 reservas:");
  const r = await unirse(api, partido, conDos);
  esOk(r, "con 2 reservas se puede unir:");
  assert.deepEqual((await verPartido(api, partido)).jugadores, [organizador, conDos]);
});

prueba("C11 · los partidos en los que juega sin organizarlos cuentan: con 3, reservar, crear un partido y unirse a otro dan 409 LIMITE_DE_RESERVAS", async (api) => {
  const [o1, o2, o3, o4, socio] = await sociosAlDia(api, 5);
  const [p1, p2, p3, p4] = await partidosDe(api, [o1, o2, o3, o4]);
  for (const partido of [p1, p2, p3]) await unir(api, partido, socio);
  const antes = await totalReservas(api);
  esError(await pedirReserva(api, socio, "pista-3", "2027-01-12T12:00"), 409, "LIMITE_DE_RESERVAS", "reservar:");
  esError(await pedirPartido(api, socio, { pistaId: "pista-3", inicio: "2027-01-12T13:30" }), 409, "LIMITE_DE_RESERVAS", "crear un partido:");
  esError(await unirse(api, p4, socio), 409, "LIMITE_DE_RESERVAS", "unirse a un cuarto partido:");
  assert.equal(await totalReservas(api), antes, "no se reserva nada");
  assert.ok(!(await verPartido(api, p4)).jugadores?.includes(socio), "no entra en el cuarto partido");
});

prueba("C11 · los partidos cuentan junto con las reservas normales: con 2 reservas y un partido, reservar y crear un partido dan 409 LIMITE_DE_RESERVAS", async (api) => {
  const [organizador, socio] = await sociosAlDia(api, 2);
  for (const dia of ["05", "06"]) await reservar(api, socio, "pista-3", `2027-01-${dia}T12:00`);
  const partido = await crearPartido(api, organizador, { pistaId: "pista-1", inicio: "2027-01-08T10:30" });
  await unir(api, partido, socio);
  esError(await pedirReserva(api, socio, "pista-3", "2027-01-07T12:00"), 409, "LIMITE_DE_RESERVAS", "reservar:");
  esError(await pedirPartido(api, socio, { pistaId: "pista-2", inicio: "2027-01-09T10:30" }), 409, "LIMITE_DE_RESERVAS", "crear un partido:");
});

prueba("C11 · el partido que organiza cuenta una sola vez, por su reserva: puede organizar 3 y, con ellos, nada más", async (api) => {
  const [organizador, otro] = await sociosAlDia(api, 2);
  for (const inicio of ["2027-01-06T10:30", "2027-01-07T10:30", "2027-01-08T10:30"]) {
    const r = await pedirPartido(api, organizador, { pistaId: "pista-1", inicio });
    assert.ok(r.status >= 200 && r.status < 300, `organizar el partido del ${inicio}: ${r.status} ${r.texto}`);
  }
  const ajeno = await crearPartido(api, otro, { pistaId: "pista-2", inicio: "2027-01-09T10:30" });
  esError(await pedirPartido(api, organizador, { pistaId: "pista-1", inicio: "2027-01-09T10:30" }), 409, "LIMITE_DE_RESERVAS", "un cuarto partido:");
  esError(await pedirReserva(api, organizador, "pista-3", "2027-01-09T10:30"), 409, "LIMITE_DE_RESERVAS", "una reserva:");
  esError(await unirse(api, ajeno, organizador), 409, "LIMITE_DE_RESERVAS", "unirse a otro partido:");
});

prueba("C11 · no cuentan los partidos cancelados", async (api) => {
  const [o1, o2, o3, socio] = await sociosAlDia(api, 4);
  const [p1, p2, p3] = await partidosDe(api, [o1, o2, o3]);
  for (const partido of [p1, p2, p3]) await unir(api, partido, socio);
  esError(await pedirReserva(api, socio, "pista-3", "2027-01-12T12:00"), 409, "LIMITE_DE_RESERVAS", "con 3 partidos:");
  // Cancelar es de C15: aquí solo se comprueba lo que pasa después, si se acepta.
  const cancelacion = await cancelar(api, p2, o2);
  if (!salioBien(cancelacion) || (await verPartido(api, p2)).estado !== "cancelado") return;
  const r = await pedirReserva(api, socio, "pista-3", "2027-01-12T12:00");
  esOk(r, "con uno de sus 3 partidos cancelado, ya puede reservar:");
});

prueba("C11 · no cuentan los partidos que ya han empezado", async (api) => {
  const [organizador, a, b, socio] = await sociosAlDia(api, 4);
  const partido = await crearPartido(api, organizador, { pistaId: "pista-1", inicio: "2027-01-05T10:30" });
  await unir(api, partido, a, b, socio); // completo: no se cancela solo
  for (const dia of ["08", "09"]) await reservar(api, socio, "pista-3", `2027-01-${dia}T12:00`);
  esError(await pedirReserva(api, socio, "pista-3", "2027-01-10T12:00"), 409, "LIMITE_DE_RESERVAS", "antes de que empiece el partido:");
  await reloj(api, "2027-01-05T11:00"); // el partido empezó hace media hora
  const r = await pedirReserva(api, socio, "pista-3", "2027-01-10T12:00");
  esOk(r, "con el partido ya empezado, puede reservar:");
});

prueba("C11 · solo cuentan los partidos en los que juega: al salir de uno, deja de contar", async (api) => {
  const [o1, o2, o3, socio] = await sociosAlDia(api, 4);
  const [p1, p2, p3] = await partidosDe(api, [o1, o2, o3]);
  for (const partido of [p1, p2, p3]) await unir(api, partido, socio);
  esError(await pedirReserva(api, socio, "pista-3", "2027-01-12T12:00"), 409, "LIMITE_DE_RESERVAS", "con 3 partidos:");
  // Salir es de C12: aquí solo se comprueba lo que pasa después, si se acepta.
  const salida = await salir(api, p3, socio);
  if (!salioBien(salida) || (await verPartido(api, p3)).jugadores?.includes(socio)) return;
  const r = await pedirReserva(api, socio, "pista-3", "2027-01-12T12:00");
  esOk(r, "tras salir de uno de sus 3 partidos, puede reservar:");
});
