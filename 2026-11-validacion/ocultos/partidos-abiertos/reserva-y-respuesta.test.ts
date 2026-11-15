// Tests ocultos de la spec `partidos-abiertos`: la reserva del partido (C5), la respuesta y la consulta (C6) y el precio
// por jugador (C7).
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en test-ocultos/
// dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test. Cada prueba arranca su propia API.
// Los precios de la semilla son múltiplos de 4, así que el redondeo hacia arriba de C7 no se puede provocar: se comprueban
// los importes exactos.
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

const campos = (r: any) => ({ socioId: r.socioId, pistaId: r.pistaId, inicio: r.inicio, fin: r.fin, estado: r.estado, importe: r.importe });

function idValido(id: unknown): boolean {
  return (typeof id === "string" && id !== "") || (typeof id === "number" && Number.isFinite(id));
}

prueba("C5 · el partido crea una reserva confirmada a nombre del organizador, con el importe de siempre y su partidoId, que sale en GET /api/reservas y es la de su reservaId", async (api) => {
  const [a, b] = await sociosAlDia(api, 2);
  const casos = [
    { organizador: a, pistaId: "pista-1", inicio: "2027-01-06T10:30", fin: "2027-01-06T12:00", importe: 1800 }, // miércoles por la mañana: valle
    { organizador: b, pistaId: "pista-3", inicio: "2027-01-09T19:30", fin: "2027-01-09T21:00", importe: 2000 }, // sábado: punta
  ];
  for (const caso of casos) {
    const antes = await totalReservas(api);
    const partido = await crearPartido(api, caso.organizador, { pistaId: caso.pistaId, inicio: caso.inicio });
    assert.equal(await totalReservas(api), antes + 1, "el partido crea una sola reserva");
    const lista = await api.pedir("GET", `/api/reservas?socio=${caso.organizador}&desde=2027-01-01&limite=100`);
    assert.equal(lista.status, 200, lista.texto);
    assert.equal(lista.cuerpo.reservas.length, 1, `GET /api/reservas trae la reserva del partido: ${lista.texto}`);
    const enLista = lista.cuerpo.reservas[0];
    const esperado = { socioId: caso.organizador, pistaId: caso.pistaId, inicio: caso.inicio, fin: caso.fin, estado: "confirmada", importe: caso.importe };
    assert.deepEqual(campos(enLista), esperado, JSON.stringify(enLista));
    assert.ok(enLista.partidoId !== undefined && enLista.partidoId !== null, `la reserva lleva partidoId: ${JSON.stringify(enLista)}`);
    assert.equal(String(enLista.partidoId), String(partido.id), "partidoId es el id del partido");
    assert.equal(String(partido.reservaId), String(enLista.id), `el reservaId del partido es el id de su reserva: ${JSON.stringify(partido)}`);
    const sola = await verReserva(api, enLista.id);
    assert.deepEqual(campos(sola), esperado, JSON.stringify(sola));
    assert.equal(String(sola.partidoId), String(partido.id), "partidoId también en GET /api/reservas/:id");
  }
});

prueba("C5 · la franja del partido sale reservada en la disponibilidad", async (api) => {
  const [organizador] = await sociosAlDia(api, 1);
  const inicio = "2027-01-07T18:00";
  assert.equal(await estadoFranja(api, "pista-2", inicio), "libre");
  await crearPartido(api, organizador, { pistaId: "pista-2", inicio });
  assert.equal(await estadoFranja(api, "pista-2", inicio), "reservada");
  assert.equal(await estadoFranja(api, "pista-1", inicio), "libre", "las demás pistas siguen libres");
});

prueba("C6 · POST /api/partidos responde 201 { partido }: abierto, con el organizador como único jugador, 3 plazas libres y sin penalizaciones", async (api) => {
  const [organizador] = await sociosAlDia(api, 1);
  const r = await pedirPartido(api, organizador, { pistaId: "pista-2", inicio: "2027-01-07T18:00" });
  assert.equal(r.status, 201, r.texto);
  const p = r.cuerpo?.partido;
  assert.ok(p && typeof p === "object", `la respuesta es { partido }: ${r.texto}`);
  assert.ok(idValido(p.id), `el partido trae id: ${r.texto}`);
  assert.deepEqual(
    { pistaId: p.pistaId, inicio: p.inicio, fin: p.fin, organizador: p.organizador, jugadores: p.jugadores, plazasLibres: p.plazasLibres, estado: p.estado, penalizaciones: p.penalizaciones },
    { pistaId: "pista-2", inicio: "2027-01-07T18:00", fin: "2027-01-07T19:30", organizador, jugadores: [organizador], plazasLibres: 3, estado: "abierto", penalizaciones: [] },
  );
});

/** Los campos de un partido que da la spec. */
const CAMPOS = ["id", "reservaId", "pistaId", "inicio", "fin", "organizador", "jugadores", "plazasLibres", "nivelMin", "nivelMax", "estado", "importe", "importePorJugador", "penalizaciones"];

prueba("C6 · GET /api/partidos/:id devuelve { partido } con el partido", async (api) => {
  const [a, b] = await sociosAlDia(api, 2);
  const creados = [
    await crearPartido(api, a, { pistaId: "pista-1", inicio: "2027-01-06T10:30" }),
    await crearPartido(api, b, { pistaId: "pista-3", inicio: "2027-01-08T19:30" }),
  ];
  for (const [i, creado] of creados.entries()) {
    const r = await api.pedir("GET", rutaPartido(creado));
    assert.equal(r.status, 200, r.texto);
    const p = r.cuerpo?.partido;
    assert.ok(p && typeof p === "object", `la respuesta es { partido }: ${r.texto}`);
    assert.equal(String(p.id), String(creado.id));
    assert.equal(p.organizador, [a, b][i], r.texto);
    for (const campo of CAMPOS) assert.deepEqual(p[campo], creado[campo], `${campo} del partido ${creado.id}: ${r.texto}`);
  }
});

prueba("C6 · si el partido no existe, 404 PARTIDO_NO_ENCONTRADO al consultarlo, al unirse, al salir y al cancelarlo", async (api) => {
  const [organizador, socio] = await sociosAlDia(api, 2);
  esError(await api.pedir("GET", "/api/partidos/P-0001"), 404, "PARTIDO_NO_ENCONTRADO", "antes de crear ninguno:");
  await crearPartido(api, organizador, { pistaId: "pista-1", inicio: "2027-01-06T10:30" });
  for (const id of ["no-existe", "P-9999", "999999"]) {
    const ruta = `/api/partidos/${id}`;
    esError(await api.pedir("GET", ruta), 404, "PARTIDO_NO_ENCONTRADO", `GET ${ruta}:`);
    esError(await api.pedir("POST", `${ruta}/unirse`, { socio }), 404, "PARTIDO_NO_ENCONTRADO", `unirse a ${id}:`);
    esError(await api.pedir("POST", `${ruta}/salir`, { cuerpo: {}, socio }), 404, "PARTIDO_NO_ENCONTRADO", `salir de ${id}:`);
    esError(await api.pedir("POST", `${ruta}/cancelar`, { cuerpo: {}, socio: GESTOR }), 404, "PARTIDO_NO_ENCONTRADO", `cancelar ${id}:`);
  }
});

prueba("C7 · importePorJugador es la cuarta parte del importe, que es el de la reserva", async (api) => {
  const organizadores = await sociosAlDia(api, 4);
  const casos = [
    { pistaId: "pista-1", inicio: "2027-01-06T10:30", importe: 1800, porJugador: 450 }, // miércoles por la mañana: valle
    { pistaId: "pista-2", inicio: "2027-01-07T19:30", importe: 2800, porJugador: 700 }, // jueves por la tarde: punta
    { pistaId: "pista-3", inicio: "2027-01-08T13:30", importe: 1200, porJugador: 300 }, // viernes a mediodía: valle
    { pistaId: "pista-3", inicio: "2027-01-10T12:00", importe: 2000, porJugador: 500 }, // domingo: punta
  ];
  for (const [i, caso] of casos.entries()) {
    const creado = await crearPartido(api, organizadores[i]!, { pistaId: caso.pistaId, inicio: caso.inicio });
    assert.deepEqual([creado.importe, creado.importePorJugador], [caso.importe, caso.porJugador], `al crearlo: ${JSON.stringify(creado)}`);
    const visto = await verPartido(api, creado);
    assert.deepEqual([visto.importe, visto.importePorJugador], [caso.importe, caso.porJugador], `en GET /api/partidos/:id: ${JSON.stringify(visto)}`);
  }
});

prueba("C7 · importePorJugador sigue siendo la cuarta parte cuando se une gente", async (api) => {
  const [organizador, a, b, c] = await sociosAlDia(api, 4);
  const partido = await crearPartido(api, organizador, { pistaId: "pista-2", inicio: "2027-01-07T19:30" });
  for (const socio of [a, b, c]) {
    await unir(api, partido, socio);
    const visto = await verPartido(api, partido);
    assert.deepEqual([visto.importe, visto.importePorJugador], [2800, 700], JSON.stringify(visto));
  }
});
