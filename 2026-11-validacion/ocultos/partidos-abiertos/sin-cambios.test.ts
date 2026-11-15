// Tests ocultos de la spec `partidos-abiertos`: lo demás no cambia (C20). Lo esperado es lo que hace la base `club/`, y estos
// tests tienen que pasar también contra ella: no crean partidos.
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en test-ocultos/
// dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test. Cada prueba arranca su propia API.
// El límite de 3 se prueba aquí solo con reservas normales, que cuentan igual que antes: lo que cambia con los partidos es de C11.
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

function cancelarReserva(api: Api, id: string, cuerpo: Record<string, unknown> = {}, socio?: string) {
  return api.pedir("POST", `/api/reservas/${id}/cancelar`, { cuerpo, socio });
}

const campos = (x: any) => ({ socioId: x.socioId, pistaId: x.pistaId, inicio: x.inicio, fin: x.fin, estado: x.estado, importe: x.importe, notas: x.notas });

prueba("C20 · reservar funciona igual: 201 con la reserva confirmada, su fin, su precio y sus notas, con X-Socio o sin ella", async (api) => {
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
    assert.ok(nueva.partidoId === undefined || nueva.partidoId === null, `una reserva normal no es de ningún partido: ${r.texto}`);
    const guardada = await api.pedir("GET", `/api/reservas/${nueva.id}`);
    assert.deepEqual(campos(guardada.cuerpo.reserva), esperado);
    const dia = await api.pedir("GET", `/api/disponibilidad?fecha=${caso.inicio.slice(0, 10)}&pista=${caso.pistaId}`);
    assert.equal(dia.cuerpo.pistas[0].franjas.find((f: any) => f.inicio === caso.inicio).estado, "reservada");
  }
});

prueba("C20 · reservar mantiene sus errores", async (api) => {
  const [a, b] = await sociosAlDia(api, 2);
  const moroso = await socioSinCuota(api);
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

prueba("C20 · el límite de 3 reservas futuras sigue igual con reservas normales: la cuarta da LIMITE_DE_RESERVAS y no cuentan las canceladas ni las que ya han empezado", async (api) => {
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

prueba("C20 · con la semilla, Luis Martín tiene 2 reservas futuras: puede hacer una más y la siguiente da LIMITE_DE_RESERVAS", async (api) => {
  const luis = "socio-005";
  const suyas = (await api.pedir("GET", `/api/reservas?socio=${luis}&estado=confirmada&desde=2026-11-18`)).cuerpo.reservas;
  assert.equal(suyas.filter((r: any) => r.inicio > SEMILLA).length, 2);
  await creada(api, { socioId: luis, pistaId: "pista-1", inicio: "2026-11-25T10:30" });
  esError(await crear(api, { socioId: luis, pistaId: "pista-2", inicio: "2026-11-25T10:30" }), 409, "LIMITE_DE_RESERVAS");
}, { AHORA: SEMILLA });

prueba("C20 · con la semilla, la reserva de Marta López del jueves 19 a las 09:00 (faltan 23 horas) solo se cancela con forzar y el 100 % de penalización", async (api) => {
  const delJueves = (await api.pedir("GET", "/api/reservas?socio=socio-002&fecha=2026-11-19")).cuerpo.reservas;
  const marta = delJueves.find((r: any) => r.inicio === "2026-11-19T09:00");
  assert.ok(marta, "Marta López juega el jueves 19 a las 09:00");
  esError(await cancelarReserva(api, marta.id), 409, "FUERA_DE_PLAZO");
  const forzada = await cancelarReserva(api, marta.id, { forzar: true });
  assert.equal(forzada.status, 200, forzada.texto);
  assert.equal(forzada.cuerpo.reserva.estado, "cancelada");
  assert.equal(forzada.cuerpo.reserva.penalizacion, 1200);
}, { AHORA: SEMILLA });

prueba("C20 · cancelar funciona igual: gratis con 24 horas o más; con menos, FUERA_DE_PLAZO sin forzar y el 100 % con forzar; y sus errores", async (api) => {
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
  // A 24 horas justas, gratis, y con la X-Socio de otro socio: cualquiera puede cancelar una reserva normal.
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
