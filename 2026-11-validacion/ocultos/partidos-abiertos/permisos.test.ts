// Tests ocultos de la spec `partidos-abiertos`: permisos (C1).
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en test-ocultos/
// dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test. Cada prueba arranca su propia API.
// Sin X-Socio, cancelar un partido y fijar un nivel aceptan 401 NO_IDENTIFICADO o 403 SIN_PERMISO: "Usuarios y permisos" da
// 401 cuando falta X-Socio donde hace falta, pero el criterio 1 solo da 401 para crear, unirse y salir, y para cancelar y fijar
// el nivel da 403 a quien no sea el organizador, el propio socio o un gestor.
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

/** Martes 5 de enero a las 18:00: faltan 32 horas desde ENERO. */
const PARTIDO = { pistaId: "pista-1", inicio: "2027-01-05T18:00" };
/** Lunes 4 a las 19:30: faltan 22,5 horas para PARTIDO (más de 6, así que no se cancela solo). */
const MENOS_DE_24 = "2027-01-04T19:30";
const SIN_X_SOCIO: [number, string][] = [[401, "NO_IDENTIFICADO"], [403, "SIN_PERMISO"]];

prueba("C1 · crear un partido, unirse y salir necesitan X-Socio: sin ella, 401 NO_IDENTIFICADO y no cambia nada", async (api) => {
  const [organizador] = await sociosAlDia(api, 1);
  const antes = await totalReservas(api);
  esError(await pedirPartido(api, null, PARTIDO), 401, "NO_IDENTIFICADO", "crear sin X-Socio:");
  esError(await pedirPartido(api, null, { ...PARTIDO, nivelMin: 2, nivelMax: 5 }), 401, "NO_IDENTIFICADO", "crear con rango sin X-Socio:");
  assert.equal(await totalReservas(api), antes, "sin X-Socio no se reserva nada");

  const partido = await crearPartido(api, organizador, PARTIDO);
  esError(await unirse(api, partido), 401, "NO_IDENTIFICADO", "unirse sin X-Socio:");
  esError(await salir(api, partido), 401, "NO_IDENTIFICADO", "salir sin X-Socio:");
  await reloj(api, MENOS_DE_24);
  esError(await salir(api, partido, undefined, { forzar: true }), 401, "NO_IDENTIFICADO", "salir con forzar sin X-Socio:");
  assert.deepEqual((await verPartido(api, partido)).jugadores, [organizador], "sin X-Socio no entra ni sale nadie");
});

prueba("C1 · cancelar un partido sin X-Socio no se puede (401 NO_IDENTIFICADO, o 403 SIN_PERMISO) y el partido sigue abierto", async (api) => {
  const [organizador] = await sociosAlDia(api, 1);
  const partido = await crearPartido(api, organizador, PARTIDO);
  esUnoDe(await cancelar(api, partido), SIN_X_SOCIO, "cancelar sin X-Socio:");
  await reloj(api, MENOS_DE_24);
  esUnoDe(await cancelar(api, partido, undefined, { forzar: true }), SIN_X_SOCIO, "cancelar con forzar sin X-Socio:");
  assert.equal((await verPartido(api, partido)).estado, "abierto");
});

prueba("C1 · un partido lo cancelan quien lo organiza o un gestor: otro socio, aunque juegue en él, recibe 403 SIN_PERMISO", async (api) => {
  const [organizador, jugador, otro, organizador2] = await sociosAlDia(api, 4);
  const partido = await crearPartido(api, organizador, PARTIDO);
  const otroPartido = await crearPartido(api, organizador2, { pistaId: "pista-2", inicio: "2027-01-08T10:30" });
  await unir(api, partido, jugador);
  for (const quien of [jugador, otro]) esError(await cancelar(api, partido, quien), 403, "SIN_PERMISO", `cancelar como ${quien}:`);
  await reloj(api, MENOS_DE_24);
  for (const quien of [jugador, otro]) {
    esError(await cancelar(api, partido, quien, { forzar: true }), 403, "SIN_PERMISO", `cancelar con forzar como ${quien}:`);
  }
  assert.equal((await verPartido(api, partido)).estado, "abierto", "un socio sin permiso no cancela nada");

  const r = await cancelar(api, partido, organizador, { forzar: true });
  esOk(r, "lo cancela quien lo organiza:");
  assert.equal((await verPartido(api, partido)).estado, "cancelado");
  const g = await cancelar(api, otroPartido, GESTOR);
  esOk(g, "lo cancela un gestor, aunque no juegue en él:");
  assert.equal((await verPartido(api, otroPartido)).estado, "cancelado");
});

prueba("C1 · el nivel de un socio lo fijan el propio socio o un gestor: otro socio recibe 403 SIN_PERMISO", async (api) => {
  const [socio, otro] = await sociosAlDia(api, 2);
  esError(await pedirNivel(api, socio, 3, otro), 403, "SIN_PERMISO", "otro socio le pone nivel:");
  assert.notEqual((await socioEnLista(api, socio))?.nivel, 3, "otro socio no le pone nivel");
  const propio = await pedirNivel(api, socio, 3, socio);
  esOk(propio, "el propio socio fija su nivel:");
  esError(await pedirNivel(api, socio, 5, otro), 403, "SIN_PERMISO", "otro socio le cambia el nivel:");
  esError(await pedirNivel(api, socio, null, otro), 403, "SIN_PERMISO", "otro socio le quita el nivel:");
  const tras = (await socioEnLista(api, socio))?.nivel;
  assert.ok(tras === undefined || tras === 3, `otro socio no le cambia el nivel: ${tras}`);
  const gestor = await pedirNivel(api, socio, 4.5, GESTOR);
  esOk(gestor, "un gestor fija el nivel de un socio:");
});

prueba("C1 · fijar el nivel sin X-Socio no se puede (401 NO_IDENTIFICADO, o 403 SIN_PERMISO)", async (api) => {
  const [socio] = await sociosAlDia(api, 1);
  esUnoDe(await pedirNivel(api, socio, 3, null), SIN_X_SOCIO, "fijarlo sin X-Socio:");
  esUnoDe(await pedirNivel(api, socio, null, null), SIN_X_SOCIO, "quitarlo sin X-Socio:");
  assert.notEqual((await socioEnLista(api, socio))?.nivel, 3, "sin X-Socio no cambia el nivel");
});

prueba("C1 · consultar partidos no necesita identificarse: GET /api/partidos y GET /api/partidos/:id responden sin X-Socio y con la de cualquier socio", async (api) => {
  const [organizador, otro] = await sociosAlDia(api, 2);
  const moroso = await socioSinCuota(api);
  const partido = await crearPartido(api, organizador, PARTIDO);
  for (const quien of [undefined, otro, moroso]) {
    for (const ruta of [rutaPartido(partido), "/api/partidos", "/api/partidos?fecha=2027-01-05", "/api/partidos?nivel=3"]) {
      const r = await api.pedir("GET", ruta, { socio: quien });
      assert.equal(r.status, 200, `GET ${ruta} ${quien ? `como ${quien}` : "sin X-Socio"}: ${r.texto}`);
    }
  }
});
