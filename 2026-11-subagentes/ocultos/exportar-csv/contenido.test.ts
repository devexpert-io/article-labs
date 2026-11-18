// Tests ocultos de exportar-csv, criterios 4 (filas), 5 (importes), 6 (escapado), 7 (fin de línea) y 9 (filtro por estado).
// Caja negra: la API HTTP, con /_estado para saber qué reservas deberían salir y /_reloj para preparar una penalización.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

const GESTOR = "socio-040";
/** Un periodo con todo el historial de la semilla y la semana actual, muy por debajo del máximo de 92 días. */
const SEMILLA = { desde: "2026-10-01", hasta: "2026-11-30" };
const CONSULTA_SEMILLA = `desde=${SEMILLA.desde}&hasta=${SEMILLA.hasta}`;
/** Si la API se cuelga, el test falla a los 30 segundos y la API se cierra. */
const OPCIONES = { timeout: 30_000 };

/** Arranca una API solo para este test, con la hora de Madrid (la del club), y la cierra al terminar. */
async function conApi(t: TestContext, prueba: (api: Api) => Promise<void>): Promise<void> {
  const api = await arrancarApi({ TZ: "Europe/Madrid" });
  t.signal.addEventListener("abort", () => api.cerrar(), { once: true });
  try {
    await prueba(api);
  } finally {
    api.cerrar();
  }
}

/** Pide la exportación como el gestor y comprueba que sale bien (que sea justo 200 es cosa del criterio 2). Devuelve el cuerpo. */
async function exportar(api: Api, consulta: string): Promise<string> {
  const r = await api.pedir("GET", `/api/reservas/exportar?${consulta}`, { socio: GESTOR });
  assert.ok(r.status >= 200 && r.status < 300, `${consulta}: ${r.status} ${r.texto.slice(0, 300)}`);
  return r.texto;
}

// --- Lectura del CSV -----------------------------------------------------------------------------------------

interface Campo {
  /** El valor, ya sin las comillas del RFC 4180. */
  valor: string;
  /** El campo tal como viene en el cuerpo. */
  crudo: string;
}

interface LecturaCsv {
  registros: Campo[][];
  /** Los fines de línea que hay entre registros, fuera de las comillas. */
  saltos: string[];
  /** Si el cuerpo acaba justo después de un fin de línea. */
  terminaEnSalto: boolean;
}

/**
 * Lee un CSV con las reglas del RFC 4180, pero tolerante: acepta también \n y \r sueltos como fin de línea y
 * comillas mal cerradas. Así un fallo de fin de línea o de escapado no impide comprobar los demás criterios.
 */
function leerCsv(texto: string): LecturaCsv {
  const registros: Campo[][] = [];
  const saltos: string[] = [];
  if (texto === "") return { registros, saltos, terminaEnSalto: false };
  let registro: Campo[] = [];
  let i = 0;
  for (;;) {
    const inicio = i;
    let valor = "";
    if (texto[i] === '"') {
      i++;
      while (i < texto.length) {
        if (texto[i] === '"' && texto[i + 1] === '"') {
          valor += '"';
          i += 2;
        } else if (texto[i] === '"') {
          i++;
          break;
        } else {
          valor += texto[i++];
        }
      }
    }
    while (i < texto.length && texto[i] !== "," && texto[i] !== "\r" && texto[i] !== "\n") valor += texto[i++];
    registro.push({ valor, crudo: texto.slice(inicio, i) });
    if (i >= texto.length) {
      registros.push(registro);
      return { registros, saltos, terminaEnSalto: false };
    }
    if (texto[i] === ",") {
      i++;
      continue;
    }
    const salto = texto.startsWith("\r\n", i) ? "\r\n" : texto[i]!;
    saltos.push(salto);
    registros.push(registro);
    registro = [];
    i += salto.length;
    if (i >= texto.length) return { registros, saltos, terminaEnSalto: true };
  }
}

/** Las filas de datos, sin la cabecera y sin una línea vacía al final (eso es cosa del criterio 7). */
function filasDe(texto: string): Campo[][] {
  const { registros } = leerCsv(texto);
  const ultimo = registros.at(-1);
  if (registros.length > 1 && ultimo!.length === 1 && ultimo![0]!.crudo === "") registros.pop();
  return registros.slice(1);
}

/** Cómo debe ir un campo según la spec: entre comillas si lleva comas, comillas o saltos de línea, y si no, tal cual. */
function escapado(valor: string): string {
  return /[",\r\n]/.test(valor) ? `"${valor.replaceAll('"', '""')}"` : valor;
}

// --- Lo que debería salir --------------------------------------------------------------------------------------

interface ReservaEsperada {
  id: string;
  socioId: string;
  pistaId: string;
  inicio: string;
  estado: string;
  importe: number;
  penalizacion?: number;
  notas: string;
  pista: { nombre: string };
  socio: { nombre: string; email: string };
}

/** Según /_estado, las reservas que empiezan entre desde y hasta (ambos días incluidos) y, si se pide, con ese estado. */
async function reservasDelPeriodo(api: Api, desde: string, hasta: string, estado?: string): Promise<ReservaEsperada[]> {
  const e = (await api.pedir("GET", "/_estado")).cuerpo;
  const pistas = new Map(e.pistas.map((p: { id: string }) => [p.id, p]));
  const socios = new Map(e.socios.map((s: { id: string }) => [s.id, s]));
  return e.reservas
    .filter((r: ReservaEsperada) => r.inicio.slice(0, 10) >= desde && r.inicio.slice(0, 10) <= hasta && (estado === undefined || r.estado === estado))
    .map((r: ReservaEsperada) => ({ ...r, pista: pistas.get(r.pistaId), socio: socios.get(r.socioId) }));
}

/** Las filas son exactamente las reservas esperadas: ni falta ni sobra ninguna, y ninguna sale dos veces. */
function comprobarQueSonLas(filas: Campo[][], esperadas: ReservaEsperada[]): void {
  const ids = filas.map((f) => f[0]!.valor);
  const esperados = new Set(esperadas.map((r) => r.id));
  const vistos = new Set<string>();
  const repetidos: string[] = [];
  for (const id of ids) {
    if (vistos.has(id)) repetidos.push(id);
    vistos.add(id);
  }
  const faltan = [...esperados].filter((id) => !vistos.has(id));
  const sobran = ids.filter((id) => !esperados.has(id));
  assert.deepEqual({ faltan, sobran, repetidos }, { faltan: [], sobran: [], repetidos: [] }, "debe haber una fila por cada reserva");
}

/** Las filas van por inicio y, si empiezan a la vez, por id de pista. Solo mira las filas de reservas esperadas. */
function comprobarOrden(filas: Campo[][], esperadas: ReservaEsperada[]): void {
  const porId = new Map(esperadas.map((r) => [r.id, r]));
  const enOrden = filas.map((f) => porId.get(f[0]!.valor)).filter((r) => r !== undefined);
  for (let i = 1; i < enOrden.length; i++) {
    const a = enOrden[i - 1]!;
    const b = enOrden[i]!;
    const bien = a.inicio < b.inicio || (a.inicio === b.inicio && a.pistaId <= b.pistaId);
    assert.ok(bien, `${a.id} (${a.inicio}, ${a.pistaId}) sale antes que ${b.id} (${b.inicio}, ${b.pistaId})`);
  }
}

function euros(centimos: number): string {
  return (centimos / 100).toFixed(2);
}

/** Para crear reservas: elige socios con la cuota al día y hueco (como mucho 3 reservas futuras confirmadas). */
async function preparadorDeReservas(api: Api) {
  const e = (await api.pedir("GET", "/_estado")).cuerpo;
  const huecos = new Map<string, number>();
  for (const s of e.socios) {
    if (!s.cuotaActiva) continue;
    const futuras = e.reservas.filter((r: ReservaEsperada) => r.socioId === s.id && r.estado === "confirmada" && r.inicio > e.ahora).length;
    if (futuras < 3) huecos.set(s.id, 3 - futuras);
  }
  return async (pistaId: string, inicio: string, notas?: string): Promise<{ id: string }> => {
    const socioId = [...huecos.keys()].find((id) => huecos.get(id)! > 0);
    assert.ok(socioId, "no queda ningún socio con hueco para reservar");
    huecos.set(socioId, huecos.get(socioId)! - 1);
    const cuerpo = notas === undefined ? { socioId, pistaId, inicio } : { socioId, pistaId, inicio, notas };
    const r = await api.pedir("POST", "/api/reservas", { cuerpo });
    assert.equal(r.status, 201, `no se pudo crear la reserva de ${pistaId} del ${inicio}: ${r.texto}`);
    return r.cuerpo.reserva;
  };
}

function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Los campos de la fila de una reserva. Exporta del día anterior al siguiente, para no depender de cómo se traten
 * los extremos del periodo (criterio 4), y, si no sale, mira las canceladas (por si sin filtro solo salen confirmadas).
 */
async function camposDe(api: Api, reserva: { id: string }, dia: string): Promise<Campo[]> {
  const periodo = `desde=${sumarDias(dia, -1)}&hasta=${sumarDias(dia, 1)}`;
  for (const consulta of [periodo, `${periodo}&estado=cancelada`]) {
    const fila = filasDe(await exportar(api, consulta)).find((f) => f[0]!.valor === reserva.id);
    if (fila) return fila;
  }
  assert.fail(`no sale la fila de ${reserva.id}`);
}

// --- C4 · Filas ------------------------------------------------------------------------------------------------

test("C4 · hay una fila por cada reserva que empieza en el periodo, en cualquier estado", OPCIONES, (t) => conApi(t, async (api) => {
  // Además de las de la semilla, una cancelada y una confirmada, para tener seguro más de un estado.
  const reservar = await preparadorDeReservas(api);
  const cancelada = await reservar("pista-3", "2026-11-27T12:00");
  assert.equal((await api.pedir("POST", `/api/reservas/${cancelada.id}/cancelar`)).status, 200);
  await reservar("pista-3", "2026-11-27T13:30");
  const filas = filasDe(await exportar(api, CONSULTA_SEMILLA));
  comprobarQueSonLas(filas, await reservasDelPeriodo(api, SEMILLA.desde, SEMILLA.hasta));
}));

test("C4 · desde y hasta entran enteros, también la franja de las 21:00 del último día, y no entra nada de fuera", OPCIONES, (t) => conApi(t, async (api) => {
  const reservar = await preparadorDeReservas(api);
  const antes = await reservar("pista-1", "2026-12-01T21:00");
  const primera = await reservar("pista-2", "2026-12-02T09:00");
  const ultima = await reservar("pista-3", "2026-12-03T21:00");
  const despues = await reservar("pista-1", "2026-12-04T09:00");
  const filas = filasDe(await exportar(api, "desde=2026-12-02&hasta=2026-12-03"));
  const ids = filas.map((f) => f[0]!.valor);
  assert.ok(ids.includes(primera.id), "falta la reserva de las 09:00 del día desde");
  assert.ok(ids.includes(ultima.id), "falta la reserva de las 21:00 del día hasta");
  assert.ok(!ids.includes(antes.id), "sobra la reserva del día anterior a desde");
  assert.ok(!ids.includes(despues.id), "sobra la reserva del día siguiente a hasta");
  comprobarQueSonLas(filas, await reservasDelPeriodo(api, "2026-12-02", "2026-12-03"));
}));

test("C4 · van ordenadas por inicio y, si empiezan a la vez, por id de pista", OPCIONES, (t) => conApi(t, async (api) => {
  const filasSemilla = filasDe(await exportar(api, CONSULTA_SEMILLA));
  comprobarOrden(filasSemilla, await reservasDelPeriodo(api, SEMILLA.desde, SEMILLA.hasta));
  // Creadas en otro orden: ni el orden de creación ni el id de la reserva coinciden con el que pide la spec.
  const reservar = await preparadorDeReservas(api);
  const otroDia = await reservar("pista-1", "2026-12-03T09:00");
  const p3 = await reservar("pista-3", "2026-12-02T10:30");
  const p1 = await reservar("pista-1", "2026-12-02T10:30");
  const p2 = await reservar("pista-2", "2026-12-02T10:30");
  const temprano = await reservar("pista-2", "2026-12-02T09:00");
  const filas = filasDe(await exportar(api, "desde=2026-12-02&hasta=2026-12-03"));
  assert.deepEqual(filas.map((f) => f[0]!.valor), [temprano.id, p1.id, p2.id, p3.id, otroDia.id]);
}));

test("C4 · cada fila lleva la fecha, la hora, el nombre de la pista, el nombre y el email del socio, el estado y las notas", OPCIONES, (t) => conApi(t, async (api) => {
  const filas = filasDe(await exportar(api, CONSULTA_SEMILLA));
  const porId = new Map((await reservasDelPeriodo(api, SEMILLA.desde, SEMILLA.hasta)).map((r) => [r.id, r]));
  assert.ok(filas.length > 0, "el periodo tiene reservas");
  for (const fila of filas) {
    const r = porId.get(fila[0]!.valor);
    if (!r) continue; // Las filas que sobran ya las cuenta el primer test de C4.
    const v = fila.map((c) => c.valor);
    assert.equal(v.length, 10, `${r.id}: la fila debe tener 10 campos: ${fila.map((c) => c.crudo).join(",")}`);
    assert.deepEqual(
      { fecha: v[1], hora: v[2], pista: v[3], socio: v[4], email: v[5], estado: v[6], notas: v[9] },
      { fecha: r.inicio.slice(0, 10), hora: r.inicio.slice(11, 16), pista: r.pista.nombre, socio: r.socio.nombre, email: r.socio.email, estado: r.estado, notas: r.notas },
      r.id,
    );
  }
}));

test("C4 · un periodo sin reservas no trae ninguna fila", OPCIONES, (t) => conApi(t, async (api) => {
  assert.deepEqual(await reservasDelPeriodo(api, "2030-01-01", "2030-01-31"), []);
  const filas = filasDe(await exportar(api, "desde=2030-01-01&hasta=2030-01-31"));
  assert.deepEqual(filas.map((f) => f.map((c) => c.crudo).join(",")), []);
}));

// --- C5 · Importes ---------------------------------------------------------------------------------------------

test("C5 · importe va en euros, con dos decimales y punto decimal", OPCIONES, (t) => conApi(t, async (api) => {
  // Además de las de la semilla, una de valle en la pista 3 (1200 céntimos) y una de punta en la pista 1 (2800).
  const reservar = await preparadorDeReservas(api);
  const valle = await reservar("pista-3", "2026-11-27T12:00");
  const punta = await reservar("pista-1", "2026-11-28T18:00");
  assert.equal((await camposDe(api, valle, "2026-11-27"))[7]?.valor, "12.00");
  assert.equal((await camposDe(api, punta, "2026-11-28"))[7]?.valor, "28.00");
  const filas = filasDe(await exportar(api, CONSULTA_SEMILLA));
  const porId = new Map((await reservasDelPeriodo(api, SEMILLA.desde, SEMILLA.hasta)).map((r) => [r.id, r]));
  for (const fila of filas) {
    const r = porId.get(fila[0]!.valor);
    if (!r) continue;
    assert.equal(fila[7]?.valor, euros(r.importe), `${r.id}: importe de ${r.importe} céntimos`);
  }
}));

test("C5 · si la reserva no tiene penalización, el campo va vacío", OPCIONES, (t) => conApi(t, async (api) => {
  // Una cancelada a tiempo, sin penalización.
  const reservar = await preparadorDeReservas(api);
  const gratis = await reservar("pista-2", "2026-11-28T12:00");
  const cancelada = await api.pedir("POST", `/api/reservas/${gratis.id}/cancelar`);
  assert.equal(cancelada.status, 200, cancelada.texto);
  assert.equal(cancelada.cuerpo.reserva.penalizacion, undefined);
  assert.equal((await camposDe(api, gratis, "2026-11-28"))[8]?.valor, "", "cancelada a tiempo, sin penalización");
  const filas = filasDe(await exportar(api, CONSULTA_SEMILLA));
  const porId = new Map((await reservasDelPeriodo(api, SEMILLA.desde, SEMILLA.hasta)).map((r) => [r.id, r]));
  for (const fila of filas) {
    const r = porId.get(fila[0]!.valor);
    if (!r || r.penalizacion !== undefined) continue;
    assert.equal(fila[8]?.valor, "", `${r.id} (${r.estado}) no tiene penalización`);
  }
}));

test("C5 · la penalización va en euros, con dos decimales y punto decimal", OPCIONES, (t) => conApi(t, async (api) => {
  // R-0520 (Marta López, jueves 19 a las 09:00) se cancela fuera de plazo con forzar: 1200 céntimos de penalización.
  const r0520 = await api.pedir("POST", "/api/reservas/R-0520/cancelar", { cuerpo: { forzar: true } });
  assert.equal(r0520.cuerpo?.reserva?.penalizacion, 1200, r0520.texto);
  // Y una de precio de punta, cancelada fuera de plazo moviendo el reloj.
  const reservar = await preparadorDeReservas(api);
  const punta = await reservar("pista-1", "2026-11-28T18:00");
  assert.equal((await api.pedir("POST", "/_reloj", { cuerpo: { ahora: "2026-11-28T09:00" } })).status, 200);
  const cancelada = await api.pedir("POST", `/api/reservas/${punta.id}/cancelar`, { cuerpo: { forzar: true } });
  const penalizacion = cancelada.cuerpo?.reserva?.penalizacion;
  assert.equal(typeof penalizacion, "number", cancelada.texto);
  assert.deepEqual((await camposDe(api, { id: "R-0520" }, "2026-11-19")).slice(7, 9).map((c) => c.valor), ["12.00", "12.00"]);
  assert.deepEqual((await camposDe(api, punta, "2026-11-28")).slice(7, 9).map((c) => c.valor), [euros(penalizacion), euros(penalizacion)]);
}));

// --- C6 · Escapado ---------------------------------------------------------------------------------------------

test("C6 · un campo con comas va entre comillas dobles", OPCIONES, (t) => conApi(t, async (api) => {
  const reservar = await preparadorDeReservas(api);
  const notas = "Traen palas, bolas y agua";
  const reserva = await reservar("pista-1", "2026-12-02T12:00", notas);
  const campos = await camposDe(api, reserva, "2026-12-02");
  assert.equal(campos.length, 10, `la coma de las notas no debe partir el campo: ${campos.map((c) => c.crudo).join(",")}`);
  assert.equal(campos[9]!.crudo, '"Traen palas, bolas y agua"');
  assert.equal(campos[9]!.valor, notas);
}));

test("C6 · un campo con comillas dobles va entre comillas y las de dentro se duplican", OPCIONES, (t) => conApi(t, async (api) => {
  const reservar = await preparadorDeReservas(api);
  const casos = [
    { notas: 'Dice que es "urgente"', crudo: '"Dice que es ""urgente"""', inicio: "2026-12-02T12:00" },
    { notas: '"Pepe" invita, paga "Ana"', crudo: '"""Pepe"" invita, paga ""Ana"""', inicio: "2026-12-02T13:30" },
  ];
  for (const caso of casos) {
    const reserva = await reservar("pista-1", caso.inicio, caso.notas);
    const campos = await camposDe(api, reserva, "2026-12-02");
    assert.equal(campos.length, 10, `${caso.notas}: ${campos.map((c) => c.crudo).join(",")}`);
    assert.equal(campos[9]!.crudo, caso.crudo);
    assert.equal(campos[9]!.valor, caso.notas);
  }
}));

test("C6 · un campo con saltos de línea va entre comillas dobles y conserva el salto (CR, LF o CRLF)", OPCIONES, (t) => conApi(t, async (api) => {
  const reservar = await preparadorDeReservas(api);
  const casos = [
    { notas: "Primera línea\nSegunda línea", crudo: '"Primera línea\nSegunda línea"', inicio: "2026-12-02T12:00" },
    { notas: "Hola\r\nAdiós", crudo: '"Hola\r\nAdiós"', inicio: "2026-12-02T13:30" },
  ];
  const reservas = [];
  for (const caso of casos) reservas.push(await reservar("pista-1", caso.inicio, caso.notas));
  const siguiente = await reservar("pista-1", "2026-12-02T15:00", "Sin saltos");
  for (const [i, caso] of casos.entries()) {
    const campos = await camposDe(api, reservas[i]!, "2026-12-02");
    assert.equal(campos.length, 10, `${JSON.stringify(caso.notas)}: ${JSON.stringify(campos.map((c) => c.crudo).join(","))}`);
    // El RFC 4180 admite CR, LF o CRLF dentro de un campo entre comillas: vale conservar el salto tal cual o
    // normalizarlo (ajustado tras el piloto, ver el README).
    const salto = (texto: string) => texto.replace(/\r\n|\r|\n/g, "\n");
    assert.equal(salto(campos[9]!.crudo), salto(caso.crudo));
    assert.equal(salto(campos[9]!.valor), salto(caso.notas));
  }
  // Y el salto de dentro de las comillas no parte la fila siguiente.
  const campos = await camposDe(api, siguiente, "2026-12-02");
  assert.deepEqual([campos.length, campos[9]!.valor], [10, "Sin saltos"]);
}));

test("C6 · los campos sin comas, comillas ni saltos de línea van sin comillas", OPCIONES, (t) => conApi(t, async (api) => {
  const reservar = await preparadorDeReservas(api);
  const sencillas = [
    { reserva: await reservar("pista-1", "2026-12-02T12:00", "Traen sus palas: piden bolas nuevas. Pista cubierta; gracias"), notas: "Traen sus palas: piden bolas nuevas. Pista cubierta; gracias" },
    { reserva: await reservar("pista-2", "2026-12-02T12:00"), notas: "" },
    { reserva: await reservar("pista-3", "2026-12-02T12:00", "Clase con monitor (Diego). Año 2026 ¡ojo!"), notas: "Clase con monitor (Diego). Año 2026 ¡ojo!" },
  ];
  // Una con notas que sí llevan comillas: el resto de los campos de su fila va sin ellas.
  await reservar("pista-1", "2026-12-02T13:30", 'Con coma, y "comillas"');
  for (const { reserva, notas } of sencillas) {
    const campos = await camposDe(api, reserva, "2026-12-02");
    assert.equal(campos.length, 10, `${reserva.id}: ${campos.map((c) => c.crudo).join(",")}`);
    assert.equal(campos[9]!.crudo, notas, `${reserva.id}: las notas van tal cual, sin comillas`);
  }
  // Todos los campos, de la semilla y de diciembre, van entre comillas solo si lo necesitan. Se compara con el valor
  // que trae cada campo, para que un importe mal formateado (criterio 5) no cuente aquí.
  for (const consulta of [CONSULTA_SEMILLA, "desde=2026-12-02&hasta=2026-12-02"]) {
    for (const registro of leerCsv(await exportar(api, consulta)).registros) {
      for (const campo of registro) assert.equal(campo.crudo, escapado(campo.valor), `campo ${JSON.stringify(campo.crudo)} de ${registro[0]!.valor}`);
    }
  }
}));

// --- C7 · Fin de línea -----------------------------------------------------------------------------------------

test("C7 · cada línea termina en CRLF, también la cabecera y la última", OPCIONES, (t) => conApi(t, async (api) => {
  const texto = await exportar(api, CONSULTA_SEMILLA);
  const { registros, saltos, terminaEnSalto } = leerCsv(texto);
  assert.ok(registros.length > 1, "el periodo tiene cabecera y filas");
  const otros = [...new Set(saltos.filter((s) => s !== "\r\n"))];
  assert.deepEqual(otros, [], `hay líneas que terminan en ${JSON.stringify(otros)} en vez de en CRLF`);
  assert.ok(terminaEnSalto, `la última línea debe terminar en CRLF: ...${JSON.stringify(texto.slice(-40))}`);
}));

test("C7 · sin filas, la cabecera es la única línea y termina en CRLF", OPCIONES, (t) => conApi(t, async (api) => {
  const texto = await exportar(api, "desde=2030-01-01&hasta=2030-01-31");
  if (texto === "") return; // Sin cabecera no hay línea que mirar: eso lo cuenta el criterio 3.
  assert.ok(texto.endsWith("\r\n"), `debe terminar en CRLF: ${JSON.stringify(texto)}`);
  assert.doesNotMatch(texto.slice(0, -2), /[\r\n]/, `solo debe haber una línea: ${JSON.stringify(texto)}`);
}));

// --- C9 · Filtro por estado ------------------------------------------------------------------------------------

// Aquí se mira el filtro y nada más: las filas filtradas son del periodo y de ese estado, y están todas las de ese
// estado que salen sin filtro. Si sin filtro falta alguna (extremos del periodo, truncado), eso lo cuenta el criterio 4.
const PERIODOS_ESTADOS = [{ desde: "2026-11-12", hasta: "2026-11-17" }, { desde: "2026-12-09", hasta: "2026-12-11" }];

for (const estado of ["confirmada", "cancelada", "no_presentada"]) {
  test(`C9 · estado=${estado} exporta solo las reservas del periodo en ese estado, y todas`, OPCIONES, (t) => conApi(t, async (api) => {
    // En diciembre, una cancelada y dos confirmadas, para no depender solo de la semilla.
    const reservar = await preparadorDeReservas(api);
    const cancelada = await reservar("pista-1", "2026-12-10T12:00");
    assert.equal((await api.pedir("POST", `/api/reservas/${cancelada.id}/cancelar`)).status, 200);
    await reservar("pista-2", "2026-12-10T12:00");
    await reservar("pista-3", "2026-12-10T13:30");
    for (const { desde, hasta } of PERIODOS_ESTADOS) {
      const periodo = `desde=${desde}&hasta=${hasta}`;
      const filtradas = filasDe(await exportar(api, `${periodo}&estado=${estado}`)).map((f) => f[0]!.valor);
      const sinFiltro = new Set(filasDe(await exportar(api, periodo)).map((f) => f[0]!.valor));
      const deEseEstado = (await reservasDelPeriodo(api, desde, hasta, estado)).map((r) => r.id);
      const sobran = filtradas.filter((id) => !deEseEstado.includes(id));
      const faltan = deEseEstado.filter((id) => sinFiltro.has(id) && !filtradas.includes(id));
      const repetidas = filtradas.filter((id, i) => filtradas.indexOf(id) !== i);
      assert.deepEqual({ sobran, faltan, repetidas }, { sobran: [], faltan: [], repetidas: [] }, `${periodo}&estado=${estado}`);
    }
  }));
}

test("C9 · un estado que no es confirmada, cancelada ni no_presentada responde 400 DATOS_INVALIDOS", OPCIONES, (t) => conApi(t, async (api) => {
  for (const estado of ["pendiente", "no-presentada", "confirmadas", "todas"]) {
    const r = await api.pedir("GET", `/api/reservas/exportar?${CONSULTA_SEMILLA}&estado=${estado}`, { socio: GESTOR });
    assert.equal(r.status, 400, `estado=${estado}: ${r.texto.slice(0, 300)}`);
    assert.equal(r.cuerpo?.error?.codigo, "DATOS_INVALIDOS", `estado=${estado}`);
  }
}));
