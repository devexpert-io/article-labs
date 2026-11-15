// Tests ocultos de la spec `partidos-abiertos`: cancelar un partido (C15) y la reserva va con su partido (C17).
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en test-ocultos/
// dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test. Cada prueba arranca su propia API.
// La reserva de cada partido se busca por organizador, pista y hora, sin depender del reservaId (que es de C5). Con menos de
// 24 horas se pide con forzar: true siempre que lo que se prueba es otro error, para que FUERA_DE_PLAZO no sea otro error posible.
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

/** Martes 5 de enero a las 18:00, en la pista 1: punta, 2800 céntimos. Faltan 32 horas desde ENERO. */
const PARTIDO = { pistaId: "pista-1", inicio: "2027-01-05T18:00" };

prueba("C15 · cancelar deja el partido cancelado con motivo organizador y cancela su reserva, así que la franja queda libre", async (api) => {
  const [organizador, a, otro] = await sociosAlDia(api, 3);
  const franja = { pistaId: "pista-1", inicio: "2027-01-06T10:30" };
  const partido = await crearPartido(api, organizador, franja);
  await unir(api, partido, a);
  const reserva = await reservaEn(api, organizador, franja.pistaId, franja.inicio);
  const r = await cancelar(api, partido, organizador);
  assert.equal(r.status, 200, r.texto);
  const respuesta = r.cuerpo?.partido;
  assert.ok(respuesta && typeof respuesta === "object", `la respuesta es { partido }: ${r.texto}`);
  assert.deepEqual([respuesta.estado, respuesta.motivo], ["cancelado", "organizador"], r.texto);
  const visto = await verPartido(api, partido);
  assert.deepEqual([visto.estado, visto.motivo], ["cancelado", "organizador"], JSON.stringify(visto));
  const cancelada = await verReserva(api, reserva.id);
  assert.equal(cancelada.estado, "cancelada", JSON.stringify(cancelada));
  sinPenalizacion(cancelada);
  assert.equal(await estadoFranja(api, franja.pistaId, franja.inicio), "libre");
  const nueva = await pedirReserva(api, otro, franja.pistaId, franja.inicio);
  esOk(nueva, "la franja se puede reservar:");
});

prueba("C15 · también cuando lo cancela un gestor queda con motivo organizador y su reserva cancelada", async (api) => {
  const [organizador] = await sociosAlDia(api, 1);
  const partido = await crearPartido(api, organizador, PARTIDO);
  const reserva = await reservaEn(api, organizador, PARTIDO.pistaId, PARTIDO.inicio);
  // Que un gestor puede cancelar es de C1: si no se acepta, aquí no se comprueba nada más.
  const r = await cancelar(api, partido, GESTOR);
  if (!salioBien(r)) return;
  const visto = await verPartido(api, partido);
  assert.deepEqual([visto.estado, visto.motivo], ["cancelado", "organizador"], JSON.stringify(visto));
  const cancelada = await verReserva(api, reserva.id);
  assert.equal(cancelada.estado, "cancelada", JSON.stringify(cancelada));
  sinPenalizacion(cancelada);
});

prueba("C15 · el partido cancelado sigue con motivo organizador cuando ya faltan menos de 6 horas y cuando ya ha empezado", async (api) => {
  const [organizador, a] = await sociosAlDia(api, 2);
  const partido = await crearPartido(api, organizador, PARTIDO);
  await unir(api, partido, a);
  const reserva = await reservaEn(api, organizador, PARTIDO.pistaId, PARTIDO.inicio);
  const r = await cancelar(api, partido, organizador);
  assert.equal(r.status, 200, r.texto);
  for (const ahora of ["2027-01-05T15:00", "2027-01-05T19:00"]) {
    await reloj(api, ahora);
    const visto = await verPartido(api, partido);
    assert.deepEqual([visto.estado, visto.motivo], ["cancelado", "organizador"], `a las ${ahora}: ${JSON.stringify(visto)}`);
    const cancelada = await verReserva(api, reserva.id);
    assert.equal(cancelada.estado, "cancelada", JSON.stringify(cancelada));
    sinPenalizacion(cancelada);
  }
});

prueba("C15 · con menos de 24 horas, cancelar sin forzar da 409 FUERA_DE_PLAZO y no cambia nada", async (api) => {
  const [organizador] = await sociosAlDia(api, 1);
  const partido = await crearPartido(api, organizador, PARTIDO);
  const reserva = await reservaEn(api, organizador, PARTIDO.pistaId, PARTIDO.inicio);
  await reloj(api, "2027-01-04T18:01"); // faltan 23 h 59 min
  esError(await cancelar(api, partido, organizador), 409, "FUERA_DE_PLAZO", "a 23 h 59 min:");
  esError(await cancelar(api, partido, organizador, { forzar: false }), 409, "FUERA_DE_PLAZO", "con forzar: false:");
  await reloj(api, "2027-01-05T10:00"); // faltan 8 horas
  esError(await cancelar(api, partido, organizador), 409, "FUERA_DE_PLAZO", "a 8 horas:");
  assert.equal((await verPartido(api, partido)).estado, "abierto");
  const sigue = await verReserva(api, reserva.id);
  assert.equal(sigue.estado, "confirmada", JSON.stringify(sigue));
  sinPenalizacion(sigue);
  assert.equal(await estadoFranja(api, PARTIDO.pistaId, PARTIDO.inicio), "reservada");
});

prueba("C15 · con menos de 24 horas y forzar: true se cancela, y la reserva lleva la penalización de siempre: el 100 % de su importe", async (api) => {
  const [organizador, a, organizador2, b, c, d] = await sociosAlDia(api, 6);
  const partido = await crearPartido(api, organizador, PARTIDO); // pista 1, punta: 2800
  await unir(api, partido, a);
  const completo = await crearPartido(api, organizador2, { pistaId: "pista-3", inicio: PARTIDO.inicio }); // pista 3, punta: 2000
  await unir(api, completo, b, c, d);
  await reloj(api, "2027-01-04T19:30"); // faltan 22,5 horas
  const r1 = await cancelar(api, partido, organizador, { forzar: true });
  assert.equal(r1.status, 200, r1.texto);
  await reloj(api, "2027-01-05T15:00"); // faltan 3 horas: el completo sigue en pie
  const r2 = await cancelar(api, completo, organizador2, { forzar: true });
  assert.equal(r2.status, 200, r2.texto);
  for (const [p, socio, pistaId, importe] of [[partido, organizador, "pista-1", 2800], [completo, organizador2, "pista-3", 2000]] as const) {
    const visto = await verPartido(api, p);
    assert.deepEqual([visto.estado, visto.motivo], ["cancelado", "organizador"], JSON.stringify(visto));
    const reserva = await reservaEn(api, socio, pistaId, PARTIDO.inicio);
    assert.deepEqual([reserva.estado, reserva.penalizacion], ["cancelada", importe], JSON.stringify(reserva));
    assert.equal(await estadoFranja(api, pistaId, PARTIDO.inicio), "libre");
  }
});

prueba("C15 · a 24 horas justas o más se cancela sin forzar y sin penalización", async (api) => {
  const [o1, o2, o3] = await sociosAlDia(api, 3);
  const pedidos: [string, string][] = [[o1, "pista-1"], [o2, "pista-2"], [o3, "pista-3"]];
  const partidos: any[] = [];
  for (const [organizador, pistaId] of pedidos) partidos.push(await crearPartido(api, organizador, { pistaId, inicio: PARTIDO.inicio }));
  await reloj(api, "2027-01-04T17:59"); // faltan 24 h 1 min
  const r1 = await cancelar(api, partidos[0], o1);
  assert.equal(r1.status, 200, `a 24 h 1 min: ${r1.texto}`);
  const r2 = await cancelar(api, partidos[1], o2, { forzar: true });
  assert.equal(r2.status, 200, `a 24 h 1 min con forzar: ${r2.texto}`);
  await reloj(api, "2027-01-04T18:00"); // faltan 24 horas justas
  const r3 = await cancelar(api, partidos[2], o3);
  assert.equal(r3.status, 200, `a 24 horas justas: ${r3.texto}`);
  for (const [i, [organizador, pistaId]] of pedidos.entries()) {
    assert.equal((await verPartido(api, partidos[i])).estado, "cancelado");
    const reserva = await reservaEn(api, organizador, pistaId, PARTIDO.inicio);
    assert.equal(reserva.estado, "cancelada", JSON.stringify(reserva));
    sinPenalizacion(reserva);
  }
});

prueba("C15 · un partido cancelado no se puede volver a cancelar: 409 PARTIDO_CANCELADO", async (api) => {
  const [organizador] = await sociosAlDia(api, 1);
  const partido = await crearPartido(api, organizador, PARTIDO);
  const r = await cancelar(api, partido, organizador);
  assert.equal(r.status, 200, r.texto);
  esError(await cancelar(api, partido, organizador), 409, "PARTIDO_CANCELADO", "quien lo organiza:");
  await reloj(api, "2027-01-04T19:30"); // faltan 22,5 horas: con forzar se penalizaría si se cancelara otra vez
  esError(await cancelar(api, partido, organizador, { forzar: true }), 409, "PARTIDO_CANCELADO", "con forzar:");
  const visto = await verPartido(api, partido);
  assert.deepEqual([visto.estado, visto.motivo], ["cancelado", "organizador"], JSON.stringify(visto));
  sinPenalizacion(await reservaEn(api, organizador, PARTIDO.pistaId, PARTIDO.inicio));
});

prueba("C15 · un partido que ya ha empezado no se puede cancelar: 409 FRANJA_PASADA", async (api) => {
  const [organizador, a, b, c] = await sociosAlDia(api, 4);
  const inicio = "2027-01-05T10:30";
  const partido = await crearPartido(api, organizador, { pistaId: "pista-1", inicio });
  await unir(api, partido, a, b, c); // completo: no se cancela solo
  await reloj(api, "2027-01-05T11:00"); // empezó hace media hora
  esError(await cancelar(api, partido, organizador, { forzar: true }), 409, "FRANJA_PASADA", "quien lo organiza:");
  await reloj(api, "2027-01-05T13:00"); // ya ha terminado
  esError(await cancelar(api, partido, organizador, { forzar: true }), 409, "FRANJA_PASADA", "terminado:");
  assert.equal((await verPartido(api, partido)).estado, "completo");
  const reserva = await reservaEn(api, organizador, "pista-1", inicio);
  assert.equal(reserva.estado, "confirmada", JSON.stringify(reserva));
  sinPenalizacion(reserva);
});

prueba("C17 · la reserva de un partido no se cancela con POST /api/reservas/:id/cancelar: 409 ES_UN_PARTIDO, y todo sigue igual", async (api) => {
  const [organizador, a] = await sociosAlDia(api, 2);
  const partido = await crearPartido(api, organizador, PARTIDO);
  await unir(api, partido, a);
  const reserva = await reservaEn(api, organizador, PARTIDO.pistaId, PARTIDO.inicio);
  const cancelarReserva = (cuerpo: Record<string, unknown>, socio?: string) =>
    api.pedir("POST", `/api/reservas/${encodeURIComponent(reserva.id)}/cancelar`, { cuerpo, socio });
  esError(await cancelarReserva({}), 409, "ES_UN_PARTIDO", "con más de 24 horas:");
  esError(await cancelarReserva({ motivo: "No podemos ir" }, organizador), 409, "ES_UN_PARTIDO", "con la X-Socio del organizador:");
  esError(await cancelarReserva({}, GESTOR), 409, "ES_UN_PARTIDO", "con la X-Socio de un gestor:");
  await reloj(api, "2027-01-04T19:30"); // faltan 22,5 horas
  esError(await cancelarReserva({ forzar: true }), 409, "ES_UN_PARTIDO", "con forzar:");
  const sigue = await verReserva(api, reserva.id);
  assert.equal(sigue.estado, "confirmada", JSON.stringify(sigue));
  sinPenalizacion(sigue);
  const visto = await verPartido(api, partido);
  assert.deepEqual([visto.estado, visto.jugadores], ["abierto", [organizador, a]], JSON.stringify(visto));
  assert.equal(await estadoFranja(api, PARTIDO.pistaId, PARTIDO.inicio), "reservada");
});
