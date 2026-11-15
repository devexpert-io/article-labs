// Tests ocultos de la spec `partidos-abiertos`: los partidos con plazas (C18) y sus filtros (C19).
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en test-ocultos/
// dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test. Cada prueba arranca su propia API.
// La spec no fija el orden entre partidos que empiezan a la misma hora. En los filtros (C19) solo se mira qué partidos salen:
// el orden es de C18.
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

const ordenados = (ids: string[]) => [...ids].sort();

prueba("C18 · GET /api/partidos devuelve { partidos } con los partidos abiertos que no han empezado, por orden de inicio", async (api) => {
  const organizadores = await sociosAlDia(api, 5);
  const vacia = await api.pedir("GET", "/api/partidos");
  assert.equal(vacia.status, 200, vacia.texto);
  assert.ok(Array.isArray(vacia.cuerpo?.partidos) && vacia.cuerpo.partidos.length === 0, `sin partidos, { partidos: [] }: ${vacia.texto}`);
  // Se crean desordenados, y dos empiezan a la misma hora en pistas distintas.
  const pedidos = [
    { pistaId: "pista-1", inicio: "2027-01-08T10:30" },
    { pistaId: "pista-2", inicio: "2027-01-06T19:30" },
    { pistaId: "pista-3", inicio: "2027-01-09T12:00" },
    { pistaId: "pista-1", inicio: "2027-01-06T19:30" },
    { pistaId: "pista-3", inicio: "2027-01-05T13:30" },
  ];
  const creados: any[] = [];
  for (const [i, pedido] of pedidos.entries()) creados.push(await crearPartido(api, organizadores[i]!, pedido));
  const r = await api.pedir("GET", "/api/partidos");
  assert.equal(r.status, 200, r.texto);
  assert.ok(Array.isArray(r.cuerpo?.partidos), `la respuesta es { partidos }: ${r.texto}`);
  const lista: any[] = r.cuerpo.partidos;
  assert.deepEqual(ordenados(idsDe(lista)), ordenados(idsDe(creados)), "salen todos los abiertos");
  const inicios = lista.map((p) => p.inicio);
  assert.deepEqual(inicios, [...inicios].sort(), `por orden de inicio: ${inicios.join(", ")}`);
  for (const p of lista) {
    const i = creados.findIndex((c) => String(c.id) === String(p.id));
    assert.deepEqual(
      [p.pistaId, p.inicio, p.estado, p.plazasLibres, p.jugadores],
      [pedidos[i]!.pistaId, pedidos[i]!.inicio, "abierto", 3, [organizadores[i]]],
      `cada uno es el partido completo: ${JSON.stringify(p)}`,
    );
  }
});

prueba("C18 · los partidos completos y los cancelados no salen; los abiertos, aunque solo les quede una plaza, sí", async (api) => {
  const [o1, o2, o3, o4, a, b, c, d, e] = await sociosAlDia(api, 9);
  const abierto = await crearPartido(api, o1, { pistaId: "pista-1", inicio: "2027-01-06T10:30" });
  const completo = await crearPartido(api, o2, { pistaId: "pista-2", inicio: "2027-01-06T12:00" });
  await unir(api, completo, a, b, c);
  const casiLleno = await crearPartido(api, o3, { pistaId: "pista-3", inicio: "2027-01-07T10:30" });
  await unir(api, casiLleno, d, e);
  const cancelado = await crearPartido(api, o4, { pistaId: "pista-1", inicio: "2027-01-05T18:00" });
  // Cancelar es de C15: si no se acepta, de ese partido no se comprueba nada.
  const cancelacion = await cancelar(api, cancelado, o4);
  const ids = idsDe(await partidosConPlazas(api)).filter((id) => salioBien(cancelacion) || id !== String(cancelado.id));
  assert.deepEqual(ids, [String(abierto.id), String(casiLleno.id)], `solo salen los abiertos: ${ids.join(", ")}`);
});

prueba("C19 · con fecha solo salen los partidos de ese día", async (api) => {
  const organizadores = await sociosAlDia(api, 4);
  const pedidos = [
    { pistaId: "pista-1", inicio: "2027-01-06T10:30" },
    { pistaId: "pista-2", inicio: "2027-01-06T19:30" },
    { pistaId: "pista-1", inicio: "2027-01-07T10:30" },
    { pistaId: "pista-3", inicio: "2027-01-08T12:00" },
  ];
  const creados: any[] = [];
  for (const [i, pedido] of pedidos.entries()) creados.push(await crearPartido(api, organizadores[i]!, pedido));
  const casos: [string, any[]][] = [
    ["2027-01-06", [creados[0], creados[1]]],
    ["2027-01-07", [creados[2]]],
    ["2027-01-08", [creados[3]]],
    ["2027-01-10", []],
  ];
  for (const [fecha, esperados] of casos) {
    const ids = idsDe(await partidosConPlazas(api, `?fecha=${fecha}`));
    assert.deepEqual(ordenados(ids), ordenados(idsDe(esperados)), `fecha=${fecha}: ${ids.join(", ")}`);
  }
});

prueba("C19 · con nivel solo salen los que admiten ese nivel: los que no tienen rango y los que tienen uno que lo incluye, con los extremos", async (api) => {
  const [oSin, oA, oB, oC, oD] = await sociosAlDia(api, 5);
  await fijarNivel(api, oA, 3);
  await fijarNivel(api, oB, 5);
  await fijarNivel(api, oC, 3);
  await fijarNivel(api, oD, 4);
  const sinRango = await crearPartido(api, oSin, { pistaId: "pista-1", inicio: "2027-01-06T10:30" });
  const deDosACuatro = await crearPartido(api, oA, { pistaId: "pista-2", inicio: "2027-01-06T10:30", nivelMin: 2, nivelMax: 4 });
  const deCuatroYMedioASeis = await crearPartido(api, oB, { pistaId: "pista-3", inicio: "2027-01-06T10:30", nivelMin: 4.5, nivelMax: 6 });
  const deDosYMedioATresYMedio = await crearPartido(api, oC, { pistaId: "pista-1", inicio: "2027-01-07T10:30", nivelMin: 2.5, nivelMax: 3.5 });
  const deUnoASiete = await crearPartido(api, oD, { pistaId: "pista-2", inicio: "2027-01-07T10:30", nivelMin: 1, nivelMax: 7 });
  const casos: [string, any[]][] = [
    ["3", [sinRango, deDosACuatro, deDosYMedioATresYMedio, deUnoASiete]],
    ["2", [sinRango, deDosACuatro, deUnoASiete]],
    ["4", [sinRango, deDosACuatro, deUnoASiete]],
    ["2.5", [sinRango, deDosACuatro, deDosYMedioATresYMedio, deUnoASiete]],
    ["3.5", [sinRango, deDosACuatro, deDosYMedioATresYMedio, deUnoASiete]],
    ["4.5", [sinRango, deCuatroYMedioASeis, deUnoASiete]],
    ["6", [sinRango, deCuatroYMedioASeis, deUnoASiete]],
    ["5.5", [sinRango, deCuatroYMedioASeis, deUnoASiete]],
    ["1", [sinRango, deUnoASiete]],
    ["7", [sinRango, deUnoASiete]],
  ];
  for (const [nivel, esperados] of casos) {
    const ids = idsDe(await partidosConPlazas(api, `?nivel=${nivel}`));
    assert.deepEqual(ordenados(ids), ordenados(idsDe(esperados)), `nivel=${nivel}: ${ids.join(", ")}`);
  }
  // Con los dos filtros a la vez.
  const delSeis = idsDe(await partidosConPlazas(api, "?fecha=2027-01-06&nivel=3"));
  assert.deepEqual(ordenados(delSeis), ordenados(idsDe([sinRango, deDosACuatro])), `fecha=2027-01-06&nivel=3: ${delSeis.join(", ")}`);
  const delSiete = idsDe(await partidosConPlazas(api, "?fecha=2027-01-07&nivel=4")); // 4 queda fuera del de 2,5 a 3,5
  assert.deepEqual(ordenados(delSiete), ordenados(idsDe([deUnoASiete])), `fecha=2027-01-07&nivel=4: ${delSiete.join(", ")}`);
});

prueba("C19 · con una fecha o un nivel que no valen, 400 DATOS_INVALIDOS", async (api) => {
  const [organizador] = await sociosAlDia(api, 1);
  await crearPartido(api, organizador, { pistaId: "pista-1", inicio: "2027-01-06T10:30" });
  for (const fecha of ["2027-1-6", "06/01/2027", "hoy", "2027-01-06T10:30"]) {
    esError(await api.pedir("GET", `/api/partidos?fecha=${encodeURIComponent(fecha)}`), 400, "DATOS_INVALIDOS", `fecha=${fecha}:`);
  }
  for (const nivel of ["8", "0.5", "0", "7.5", "3.25", "abc"]) {
    esError(await api.pedir("GET", `/api/partidos?nivel=${encodeURIComponent(nivel)}`), 400, "DATOS_INVALIDOS", `nivel=${nivel}:`);
  }
});
