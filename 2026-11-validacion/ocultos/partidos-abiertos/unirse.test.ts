// Tests ocultos de la spec `partidos-abiertos`: unirse (C8), quién se puede unir (C9) y el nivel al unirse (C10).
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en test-ocultos/
// dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test. Cada prueba arranca su propia API.
// En cada intento fallido solo se incumple una regla: el partido no está completo salvo que se pruebe eso, nadie llega al
// límite de 3 reservas y los partidos empiezan a más de dos días del reloj.
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
/** Un partido con rango de 2,5 a 4 (su organizador tendrá nivel 3). */
const CON_RANGO = { ...FRANJA, nivelMin: 2.5, nivelMax: 4 };

prueba("C8 · unirse añade a quien llama al final de jugadores, por orden de llegada, y le quita una plaza libre al partido", async (api) => {
  const socios = await sociosAlDia(api, 10);
  // Ni por id ni por nombre: por orden de llegada.
  const [organizador, primero, segundo] = [socios[4]!, socios[9]!, socios[1]!];
  const partido = await crearPartido(api, organizador, FRANJA);
  const pasos: [string, string[], number][] = [[primero, [organizador, primero], 2], [segundo, [organizador, primero, segundo], 1]];
  for (const [socio, jugadores, plazasLibres] of pasos) {
    const r = await unirse(api, partido, socio);
    assert.equal(r.status, 200, r.texto);
    const respuesta = r.cuerpo?.partido;
    assert.ok(respuesta && typeof respuesta === "object", `la respuesta es { partido }: ${r.texto}`);
    assert.deepEqual([respuesta.jugadores, respuesta.plazasLibres, respuesta.estado], [jugadores, plazasLibres, "abierto"], r.texto);
    const visto = await verPartido(api, partido);
    assert.deepEqual([visto.jugadores, visto.plazasLibres, visto.estado], [jugadores, plazasLibres, "abierto"], JSON.stringify(visto));
  }
});

prueba("C8 · con el cuarto jugador, el partido pasa a completo, sin plazas libres", async (api) => {
  const [organizador, a, b, c] = await sociosAlDia(api, 4);
  const partido = await crearPartido(api, organizador, FRANJA);
  await unir(api, partido, a, b);
  const r = await unirse(api, partido, c);
  assert.equal(r.status, 200, r.texto);
  assert.deepEqual([r.cuerpo?.partido?.estado, r.cuerpo?.partido?.plazasLibres], ["completo", 0], r.texto);
  const visto = await verPartido(api, partido);
  assert.deepEqual([visto.jugadores, visto.plazasLibres, visto.estado], [[organizador, a, b, c], 0, "completo"], JSON.stringify(visto));
});

prueba("C9 · a un partido completo no se puede unir nadie: 409 PARTIDO_COMPLETO", async (api) => {
  const [organizador, a, b, c, d] = await sociosAlDia(api, 5);
  const partido = await crearPartido(api, organizador, FRANJA);
  await unir(api, partido, a, b, c);
  esError(await unirse(api, partido, d), 409, "PARTIDO_COMPLETO");
  const visto = await verPartido(api, partido);
  assert.deepEqual([visto.jugadores, visto.estado], [[organizador, a, b, c], "completo"], JSON.stringify(visto));
});

prueba("C9 · a un partido cancelado no se puede unir nadie: 409 PARTIDO_CANCELADO", async (api) => {
  const [organizador, a, b] = await sociosAlDia(api, 3);
  const partido = await crearPartido(api, organizador, FRANJA);
  await unir(api, partido, a);
  // Cancelar es de C15: aquí solo se comprueba lo que pasa después, si se acepta.
  const cancelacion = await cancelar(api, partido, organizador);
  if (!salioBien(cancelacion) || (await verPartido(api, partido)).estado !== "cancelado") return;
  esError(await unirse(api, partido, b), 409, "PARTIDO_CANCELADO");
  assert.ok(!(await verPartido(api, partido)).jugadores?.includes(b), "no entra en el partido");
});

prueba("C9 · quien ya juega en el partido no se puede volver a unir: 409 YA_APUNTADO, tampoco el organizador", async (api) => {
  const [organizador, a] = await sociosAlDia(api, 2);
  const partido = await crearPartido(api, organizador, FRANJA);
  await unir(api, partido, a);
  esError(await unirse(api, partido, a), 409, "YA_APUNTADO", "quien ya se unió:");
  esError(await unirse(api, partido, organizador), 409, "YA_APUNTADO", "el organizador:");
  const visto = await verPartido(api, partido);
  assert.deepEqual([visto.jugadores, visto.plazasLibres], [[organizador, a], 2], JSON.stringify(visto));
});

prueba("C9 · quien no tiene la cuota al día no se puede unir: 409 CUOTA_INACTIVA", async (api) => {
  const [organizador] = await sociosAlDia(api, 1);
  const moroso = await socioSinCuota(api);
  const partido = await crearPartido(api, organizador, FRANJA);
  esError(await unirse(api, partido, moroso), 409, "CUOTA_INACTIVA");
  assert.deepEqual((await verPartido(api, partido)).jugadores, [organizador]);
});

prueba("C10 · en un partido con rango, quien no tiene nivel no se puede unir: 409 NIVEL_SIN_DEFINIR", async (api) => {
  const [organizador, sinNivel, quitado] = await sociosAlDia(api, 3);
  await fijarNivel(api, organizador, 3);
  await fijarNivel(api, quitado, 3);
  await fijarNivel(api, quitado, null);
  const partido = await crearPartido(api, organizador, CON_RANGO);
  esError(await unirse(api, partido, sinNivel), 409, "NIVEL_SIN_DEFINIR", "sin nivel:");
  esError(await unirse(api, partido, quitado), 409, "NIVEL_SIN_DEFINIR", "con el nivel quitado:");
  assert.deepEqual((await verPartido(api, partido)).jugadores, [organizador]);
});

prueba("C10 · en un partido con rango, quien tiene un nivel fuera no se puede unir: 409 NIVEL_FUERA_DE_RANGO", async (api) => {
  const [organizador, ...otros] = await sociosAlDia(api, 5);
  await fijarNivel(api, organizador, 3);
  const partido = await crearPartido(api, organizador, CON_RANGO);
  for (const [i, nivel] of [2, 4.5, 1, 7].entries()) {
    await fijarNivel(api, otros[i]!, nivel);
    esError(await unirse(api, partido, otros[i]!), 409, "NIVEL_FUERA_DE_RANGO", `con nivel ${nivel}, en un partido de 2,5 a 4:`);
  }
  assert.deepEqual((await verPartido(api, partido)).jugadores, [organizador]);
});

prueba("C10 · en un partido con rango se une quien está dentro, con los extremos incluidos", async (api) => {
  const [organizador, enElMinimo, enElMaximo, enMedio] = await sociosAlDia(api, 4);
  await fijarNivel(api, organizador, 3);
  const partido = await crearPartido(api, organizador, CON_RANGO);
  for (const [socio, nivel] of [[enElMinimo, 2.5], [enElMaximo, 4], [enMedio, 3.5]] as const) {
    await fijarNivel(api, socio, nivel);
    const r = await unirse(api, partido, socio);
    esOk(r, `con nivel ${nivel}, en un partido de 2,5 a 4:`);
  }
  assert.deepEqual((await verPartido(api, partido)).jugadores, [organizador, enElMinimo, enElMaximo, enMedio]);
});

prueba("C10 · en un partido sin rango se une cualquiera, tenga nivel o no", async (api) => {
  const [organizador, sinNivel, bajo, alto] = await sociosAlDia(api, 4);
  await fijarNivel(api, bajo, 1);
  await fijarNivel(api, alto, 7);
  const partido = await crearPartido(api, organizador, FRANJA);
  for (const socio of [sinNivel, bajo, alto]) {
    const r = await unirse(api, partido, socio);
    esOk(r, `${socio}:`);
  }
  assert.deepEqual((await verPartido(api, partido)).jugadores, [organizador, sinNivel, bajo, alto]);
});
