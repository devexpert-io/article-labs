// Tests ocultos de la spec `partidos-abiertos`: salir (C12), salir tarde (C13) y el organizador no sale (C14).
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en test-ocultos/
// dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test. Cada prueba arranca su propia API.
// Con menos de 24 horas se pide salir con forzar: true siempre que lo que se prueba es otro error, para que FUERA_DE_PLAZO no
// sea otro error posible. Los partidos que se prueban después de empezar están completos, así que no se han cancelado solos.
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

/** Martes 5 de enero a las 18:00, en la pista 1: punta, 2800 céntimos y 700 por jugador. Faltan 32 horas desde ENERO. */
const PARTIDO = { pistaId: "pista-1", inicio: "2027-01-05T18:00" };

/**
 * Lo que paga quien sale tarde: el importePorJugador del partido en ese momento. Que valga la cuarta parte del importe es
 * de C7, así que si el partido no lo trae se usa la cuarta parte de PARTIDO (700).
 */
async function suParte(api: Api, partido: { id: unknown }): Promise<number> {
  const importe = (await verPartido(api, partido)).importePorJugador;
  return Number.isInteger(importe) ? importe : 700;
}

prueba("C12 · salir quita a quien llama de jugadores y deja libre su plaza", async (api) => {
  const [organizador, a, b] = await sociosAlDia(api, 3);
  const partido = await crearPartido(api, organizador, PARTIDO);
  await unir(api, partido, a, b);
  const r = await salir(api, partido, a);
  assert.equal(r.status, 200, r.texto);
  const respuesta = r.cuerpo?.partido;
  assert.ok(respuesta && typeof respuesta === "object", `la respuesta es { partido }: ${r.texto}`);
  assert.deepEqual([respuesta.jugadores, respuesta.plazasLibres, respuesta.estado], [[organizador, b], 2, "abierto"], r.texto);
  const visto = await verPartido(api, partido);
  assert.deepEqual([visto.jugadores, visto.plazasLibres, visto.estado], [[organizador, b], 2, "abierto"], JSON.stringify(visto));
});

prueba("C12 · si el partido estaba completo, al salir uno vuelve a abierto y otro puede ocupar su plaza", async (api) => {
  const [organizador, a, b, c, d] = await sociosAlDia(api, 5);
  const partido = await crearPartido(api, organizador, PARTIDO);
  await unir(api, partido, a, b, c);
  const r = await salir(api, partido, b);
  assert.equal(r.status, 200, r.texto);
  const visto = await verPartido(api, partido);
  assert.deepEqual([visto.jugadores, visto.plazasLibres, visto.estado], [[organizador, a, c], 1, "abierto"], JSON.stringify(visto));
  const otro = await unirse(api, partido, d);
  esOk(otro, "la plaza que ha quedado libre la ocupa otro:");
  const lleno = await verPartido(api, partido);
  assert.deepEqual([lleno.jugadores, lleno.plazasLibres, lleno.estado], [[organizador, a, c, d], 0, "completo"], JSON.stringify(lleno));
});

prueba("C12 · quien no juega en el partido no puede salir: 409 NO_APUNTADO", async (api) => {
  const [organizador, a, b] = await sociosAlDia(api, 3);
  const partido = await crearPartido(api, organizador, PARTIDO);
  await unir(api, partido, a);
  esError(await salir(api, partido, b), 409, "NO_APUNTADO", "quien nunca se ha unido:");
  const salida = await salir(api, partido, a);
  assert.equal(salida.status, 200, salida.texto);
  esError(await salir(api, partido, a), 409, "NO_APUNTADO", "quien ya ha salido:");
  assert.deepEqual((await verPartido(api, partido)).jugadores, [organizador]);
});

prueba("C12 · de un partido cancelado no se puede salir: 409 PARTIDO_CANCELADO", async (api) => {
  const [organizador, a] = await sociosAlDia(api, 2);
  const partido = await crearPartido(api, organizador, PARTIDO);
  await unir(api, partido, a);
  // Cancelar es de C15: aquí solo se comprueba lo que pasa después, si se acepta.
  const cancelacion = await cancelar(api, partido, organizador);
  if (!salioBien(cancelacion)) return;
  const cancelado = await verPartido(api, partido);
  if (cancelado.estado !== "cancelado") return;
  const r = await salir(api, partido, a);
  if (Array.isArray(cancelado.jugadores) && cancelado.jugadores.includes(a)) {
    esError(r, 409, "PARTIDO_CANCELADO");
  } else {
    // La spec no dice qué pasa con jugadores al cancelar: si se vacía, tampoco juega en él y vale también NO_APUNTADO.
    esUnoDe(r, [[409, "PARTIDO_CANCELADO"], [409, "NO_APUNTADO"]]);
  }
});

prueba("C12 · de un partido que ya ha empezado no se puede salir: 409 FRANJA_PASADA", async (api) => {
  const [organizador, a, b, c] = await sociosAlDia(api, 4);
  const partido = await crearPartido(api, organizador, { pistaId: "pista-1", inicio: "2027-01-05T10:30" });
  await unir(api, partido, a, b, c); // completo: no se cancela solo
  await reloj(api, "2027-01-05T11:00"); // empezó hace media hora
  esError(await salir(api, partido, a, { forzar: true }), 409, "FRANJA_PASADA", "en juego:");
  await reloj(api, "2027-01-05T13:00"); // ya ha terminado
  esError(await salir(api, partido, b, { forzar: true }), 409, "FRANJA_PASADA", "terminado:");
  assert.deepEqual((await verPartido(api, partido)).jugadores, [organizador, a, b, c]);
});

prueba("C13 · con menos de 24 horas, salir sin forzar da 409 FUERA_DE_PLAZO y no cambia nada", async (api) => {
  const [organizador, a] = await sociosAlDia(api, 2);
  const partido = await crearPartido(api, organizador, PARTIDO);
  await unir(api, partido, a);
  await reloj(api, "2027-01-04T18:01"); // faltan 23 h 59 min
  esError(await salir(api, partido, a), 409, "FUERA_DE_PLAZO", "a 23 h 59 min:");
  esError(await salir(api, partido, a, { forzar: false }), 409, "FUERA_DE_PLAZO", "con forzar: false:");
  await reloj(api, "2027-01-05T10:00"); // faltan 8 horas
  esError(await salir(api, partido, a), 409, "FUERA_DE_PLAZO", "a 8 horas:");
  const visto = await verPartido(api, partido);
  assert.deepEqual(visto.jugadores, [organizador, a]);
  assert.deepEqual(penalizacionesDe(visto), []);
});

prueba("C13 · con menos de 24 horas y forzar: true, quien sale paga su parte: se añade a penalizaciones con su socioId y el importePorJugador", async (api) => {
  const [organizador, a, b] = await sociosAlDia(api, 3);
  const partido = await crearPartido(api, organizador, PARTIDO);
  await unir(api, partido, a, b);
  await reloj(api, "2027-01-04T19:30"); // faltan 22,5 horas
  const parteDeA = await suParte(api, partido);
  const r1 = await salir(api, partido, a, { forzar: true });
  esOk(r1, "sale a:");
  let visto = await verPartido(api, partido);
  assert.deepEqual(visto.jugadores, [organizador, b]);
  assert.deepEqual(penalizacionesDe(visto), [[a, parteDeA]], JSON.stringify(visto));
  await reloj(api, "2027-01-05T11:30"); // faltan 6 h 30 min
  const parteDeB = await suParte(api, partido);
  const r2 = await salir(api, partido, b, { forzar: true });
  esOk(r2, "sale b:");
  visto = await verPartido(api, partido);
  assert.deepEqual(visto.jugadores, [organizador]);
  const esperadas: [string, number][] = [[a, parteDeA], [b, parteDeB]];
  assert.deepEqual(penalizacionesDe(visto), esperadas.sort((x, y) => x[0].localeCompare(y[0])), JSON.stringify(visto));
});

prueba("C13 · con 24 horas o más se sale sin forzar y sin penalización", async (api) => {
  const [organizador, a, b, c] = await sociosAlDia(api, 4);
  const partido = await crearPartido(api, organizador, PARTIDO);
  await unir(api, partido, a, b, c);
  await reloj(api, "2027-01-04T17:59"); // faltan 24 h 1 min
  const r1 = await salir(api, partido, a);
  esOk(r1, "a 24 h 1 min:");
  const r2 = await salir(api, partido, b, { forzar: true });
  esOk(r2, "a 24 h 1 min con forzar:");
  await reloj(api, "2027-01-04T18:00"); // faltan 24 horas justas
  const r3 = await salir(api, partido, c);
  esOk(r3, "a 24 horas justas:");
  const visto = await verPartido(api, partido);
  assert.deepEqual(visto.jugadores, [organizador]);
  assert.deepEqual(penalizacionesDe(visto), [], JSON.stringify(visto));
});

prueba("C14 · el organizador no puede salir de su partido: 409 ORGANIZADOR_NO_PUEDE_SALIR, tampoco con forzar ni con el partido completo", async (api) => {
  const [organizador, a, organizador2, b, c, d] = await sociosAlDia(api, 6);
  const partido = await crearPartido(api, organizador, PARTIDO);
  await unir(api, partido, a);
  const completo = await crearPartido(api, organizador2, { pistaId: "pista-2", inicio: PARTIDO.inicio });
  await unir(api, completo, b, c, d);
  esError(await salir(api, partido, organizador), 409, "ORGANIZADOR_NO_PUEDE_SALIR", "con más de 24 horas:");
  esError(await salir(api, completo, organizador2), 409, "ORGANIZADOR_NO_PUEDE_SALIR", "con el partido completo:");
  await reloj(api, "2027-01-04T19:30"); // faltan 22,5 horas
  esError(await salir(api, partido, organizador, { forzar: true }), 409, "ORGANIZADOR_NO_PUEDE_SALIR", "con forzar:");
  const visto = await verPartido(api, partido);
  assert.deepEqual([visto.organizador, visto.jugadores, visto.estado], [organizador, [organizador, a], "abierto"], JSON.stringify(visto));
  assert.deepEqual(penalizacionesDe(visto), []);
  assert.deepEqual((await verPartido(api, completo)).jugadores, [organizador2, b, c, d]);
});
