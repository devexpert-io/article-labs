// Tests ocultos de la spec `duraciones`: precio por minutos (C5) y lo de siempre cuesta lo mismo (C6).
// Caja negra: solo la API HTTP, con /_estado (socios) y /_reloj para preparar. Los importes esperados se calculan aquí
// con aritmética entera: numerador = minutos de valle × valle + minutos de punta × punta, y numerador / 90 redondeado al
// céntimo más cercano (medio céntimo, hacia arriba). Cada prueba arranca su propia API, con la hora de Madrid (la del club).
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

/** Si la API se cuelga, el test falla a los 30 segundos y la API se cierra. */
const OPCIONES = { timeout: 30_000 };
/** Lunes 1 de febrero de 2027: toda la semana siguiente está libre (la semilla acaba el 24 de noviembre de 2026). */
const LUNES = "2027-02-01T10:00";
/** Las horas de las franjas de siempre. */
const HORAS = ["09:00", "10:30", "12:00", "13:30", "15:00", "16:30", "18:00", "19:30", "21:00"];

interface Pista {
  id: string;
  estado: string;
  precioValle: number;
  precioPunta: number;
}

interface Reserva {
  id: string;
  pistaId: string;
  inicio: string;
  importe: number;
}

async function conApi(t: TestContext, ahora: string | null, prueba: (api: Api) => Promise<void>): Promise<void> {
  const api = await arrancarApi({ TZ: "Europe/Madrid", ...(ahora ? { AHORA: ahora } : {}) });
  t.signal.addEventListener("abort", () => api.cerrar(), { once: true });
  try {
    await prueba(api);
  } finally {
    api.cerrar();
  }
}

/** Todas las reservas de GET /api/reservas con esa consulta, página a página. */
async function listarTodas(api: Api, consulta: string): Promise<any[]> {
  const todas: any[] = [];
  for (let pagina = 1; ; pagina++) {
    const r = await api.pedir("GET", `/api/reservas?${consulta}${consulta ? "&" : ""}limite=100&pagina=${pagina}`);
    assert.equal(r.status, 200, `GET /api/reservas?${consulta}: ${r.texto.slice(0, 300)}`);
    todas.push(...r.cuerpo.reservas);
    if (pagina >= r.cuerpo.paginas) return todas;
  }
}

async function pistas(api: Api): Promise<Map<string, Pista>> {
  const r = await api.pedir("GET", "/api/pistas");
  assert.equal(r.status, 200, r.texto.slice(0, 300));
  return new Map(r.cuerpo.pistas.map((p: Pista) => [p.id, p]));
}

/**
 * Para crear reservas sin chocar con las reglas: cada una con un socio con la cuota al día (sin el gestor) y sitio
 * para otra reserva futura (como mucho 3).
 */
async function crearClub(api: Api, ahora: string) {
  const socios: { id: string; cuotaActiva: boolean; rol: string }[] = (await api.pedir("GET", "/_estado")).cuerpo.socios;
  const futuras = new Map<string, number>();
  for (const r of await listarTodas(api, `desde=${ahora.slice(0, 10)}&estado=confirmada`)) {
    if (r.inicio > ahora) futuras.set(r.socioId, (futuras.get(r.socioId) ?? 0) + 1);
  }
  const sitio = new Map(socios.filter((s) => s.cuotaActiva === true && s.rol === "socio").map((s) => [s.id, 3 - (futuras.get(s.id) ?? 0)]));
  return {
    /** Crea la reserva (sin duracion si es undefined) y comprueba que responde 201. */
    async reservar(pistaId: string, inicio: string, duracion?: number): Promise<Reserva> {
      const socioId = [...sitio].find(([, n]) => n > 0)?.[0];
      assert.ok(socioId, "no queda ningún socio con sitio para reservar");
      const cuerpo = { socioId, pistaId, inicio, ...(duracion === undefined ? {} : { duracion }) };
      const r = await api.pedir("POST", "/api/reservas", { cuerpo });
      assert.equal(r.status, 201, `${JSON.stringify(cuerpo)}: ${r.status} ${r.texto.slice(0, 300)}`);
      sitio.set(socioId, sitio.get(socioId)! - 1);
      return r.cuerpo.reserva;
    },
  };
}

function minutosDelDia(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h! * 60 + m!;
}

/** 0 es domingo y 6, sábado. Sin la zona horaria del sistema. */
function diaDeLaSemana(fecha: string): number {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a!, m! - 1, d!)).getUTCDay();
}

/** El importe según la regla de la spec, en céntimos, con aritmética entera. */
function importeEsperado(pista: Pista, inicio: string, duracion: number): number {
  const finDeSemana = [0, 6].includes(diaDeLaSemana(inicio.slice(0, 10)));
  const desde = minutosDelDia(inicio.slice(11));
  let valle = 0;
  let punta = 0;
  for (let minuto = desde; minuto < desde + duracion; minuto++) {
    if (finDeSemana || minuto >= 18 * 60) punta++;
    else valle++;
  }
  const numerador = valle * pista.precioValle + punta * pista.precioPunta;
  const resto = numerador % 90;
  const cociente = (numerador - resto) / 90;
  return 2 * resto >= 90 ? cociente + 1 : cociente;
}

/** El precio de siempre de una franja de 90 minutos: punta desde las 18:00 y todo el fin de semana (README de la base). */
function precioDeSiempre(pista: Pista, inicio: string): number {
  const finDeSemana = [0, 6].includes(diaDeLaSemana(inicio.slice(0, 10)));
  return finDeSemana || inicio.slice(11) >= "18:00" ? pista.precioPunta : pista.precioValle;
}

type Caso = [pistaId: string, inicio: string, duracion: number];

/** Crea cada reserva y comprueba su importe al crearla y al consultarla. Si se da, `literal` es el importe ya calculado a mano. */
async function comprobarImportes(api: Api, casos: Caso[], literal: Record<string, number> = {}) {
  const club = await crearClub(api, LUNES);
  const precios = await pistas(api);
  for (const [pistaId, inicio, duracion] of casos) {
    const esperado = importeEsperado(precios.get(pistaId)!, inicio, duracion);
    const clave = `${pistaId} ${inicio} ${duracion}`;
    if (clave in literal) assert.equal(esperado, literal[clave], `el cálculo del test para ${clave}`);
    const reserva = await club.reservar(pistaId, inicio, duracion);
    assert.equal(reserva.importe, esperado, `${clave} min: importe al crearla`);
    const guardada = await api.pedir("GET", `/api/reservas/${reserva.id}`);
    assert.equal(guardada.cuerpo?.reserva?.importe, esperado, `${clave} min: importe al consultarla`);
  }
}

test("C5 · de lunes a viernes, los minutos de antes de las 18:00 van a precio de valle", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  await comprobarImportes(api, [
    ["pista-1", "2027-02-02T09:30", 60], // martes
    ["pista-3", "2027-02-02T09:30", 60],
    ["pista-1", "2027-02-02T11:00", 120],
    ["pista-3", "2027-02-02T11:00", 120],
    ["pista-1", "2027-02-02T14:00", 90],
    ["pista-2", "2027-02-02T16:00", 120], // termina justo a las 18:00
    ["pista-3", "2027-02-02T17:00", 60], // termina justo a las 18:00
    ["pista-2", "2027-02-05T13:00", 60], // viernes
    ["pista-3", "2027-02-08T10:00", 120], // lunes
  ], { "pista-1 2027-02-02T09:30 60": 1200, "pista-3 2027-02-02T09:30 60": 800, "pista-1 2027-02-02T11:00 120": 2400, "pista-3 2027-02-08T10:00 120": 1600 });
}));

test("C5 · desde las 18:00, los minutos van a precio de punta y el total se redondea al céntimo más cercano", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  await comprobarImportes(api, [
    ["pista-1", "2027-02-03T18:30", 60], // 60 × 2800 / 90 = 1866,67 → 1867
    ["pista-3", "2027-02-03T18:30", 60], // 60 × 2000 / 90 = 1333,33 → 1333
    ["pista-2", "2027-02-03T19:00", 120],
    ["pista-3", "2027-02-04T20:30", 120],
    ["pista-1", "2027-02-04T21:30", 60],
    ["pista-2", "2027-02-04T18:00", 120],
    ["pista-1", "2027-02-05T19:00", 90],
    ["pista-3", "2027-02-05T18:00", 60],
  ], { "pista-1 2027-02-03T18:30 60": 1867, "pista-3 2027-02-03T18:30 60": 1333, "pista-2 2027-02-03T19:00 120": 3733, "pista-3 2027-02-04T20:30 120": 2667 });
}));

test("C5 · si la reserva cruza las 18:00, cada minuto va a su precio (el ejemplo de la spec: 2467 céntimos)", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  await comprobarImportes(api, [
    ["pista-1", "2027-02-02T17:30", 90], // el ejemplo de la spec: un martes de 17:30 a 19:00 en la pista 1
    ["pista-3", "2027-02-02T17:30", 90],
    ["pista-2", "2027-02-03T17:00", 120],
    ["pista-3", "2027-02-03T17:00", 120],
    ["pista-1", "2027-02-04T17:30", 60],
    ["pista-3", "2027-02-04T17:30", 60],
    ["pista-2", "2027-02-04T16:30", 120],
    ["pista-3", "2027-02-05T16:30", 120],
    ["pista-1", "2027-02-05T17:30", 120],
    ["pista-2", "2027-02-08T17:00", 90],
  ], {
    "pista-1 2027-02-02T17:30 90": 2467,
    "pista-3 2027-02-02T17:30 90": 1733,
    "pista-2 2027-02-03T17:00 120": 3067,
    "pista-3 2027-02-04T17:30 60": 1067,
    "pista-1 2027-02-05T17:30 120": 3400,
    "pista-2 2027-02-08T17:00 90": 2133,
  });
}));

test("C5 · el sábado y el domingo, todos los minutos van a precio de punta, también antes de las 18:00", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  await comprobarImportes(api, [
    ["pista-1", "2027-02-06T09:00", 60], // sábado
    ["pista-3", "2027-02-06T09:30", 120],
    ["pista-2", "2027-02-06T12:30", 90],
    ["pista-1", "2027-02-06T17:00", 120],
    ["pista-3", "2027-02-06T16:30", 120],
    ["pista-2", "2027-02-06T21:30", 60],
    ["pista-1", "2027-02-07T10:00", 120], // domingo
    ["pista-3", "2027-02-07T17:30", 90],
    ["pista-2", "2027-02-07T15:00", 60],
    ["pista-1", "2027-02-07T20:30", 120],
  ], { "pista-1 2027-02-06T09:00 60": 1867, "pista-3 2027-02-06T09:30 120": 2667, "pista-2 2027-02-06T12:30 90": 2800, "pista-3 2027-02-07T17:30 90": 2000 });
}));

/**
 * Reserva las nueve franjas de siempre en las pistas 1, 2 y 3 y comprueba que cuestan lo mismo que antes. Las franjas
 * alternas van a días distintos (`dias[0]` y `dias[1]`) para que ninguna reserva toque a otra de su pista.
 */
async function comprobarFranjasDeSiempre(api: Api, parejas: [string, string][], duracion: number | undefined) {
  const club = await crearClub(api, LUNES);
  const precios = await pistas(api);
  for (const dias of parejas) {
    for (const pistaId of ["pista-1", "pista-2", "pista-3"]) {
      for (const [i, hora] of HORAS.entries()) {
        const inicio = `${dias[i % 2]}T${hora}`;
        const esperado = precioDeSiempre(precios.get(pistaId)!, inicio);
        const reserva = await club.reservar(pistaId, inicio, duracion);
        assert.equal(reserva.importe, esperado, `${pistaId} ${inicio}${duracion ? " con duracion: 90" : " sin duracion"}`);
        const guardada = await api.pedir("GET", `/api/reservas/${reserva.id}`);
        assert.equal(guardada.cuerpo?.reserva?.importe, esperado, `${pistaId} ${inicio}, al consultarla`);
      }
    }
  }
}

test("C6 · sin duracion, una reserva a una hora de siempre cuesta lo mismo que antes, entre semana y en fin de semana", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  await comprobarFranjasDeSiempre(api, [["2027-02-03", "2027-02-04"], ["2027-02-06", "2027-02-07"]], undefined); // miércoles y jueves, sábado y domingo
}));

test("C6 · con duracion: 90, una reserva a una hora de siempre cuesta lo mismo que antes, entre semana y en fin de semana", OPCIONES, (t) => conApi(t, LUNES, async (api) => {
  await comprobarFranjasDeSiempre(api, [["2027-02-08", "2027-02-09"], ["2027-02-13", "2027-02-14"]], 90); // lunes y martes, sábado y domingo
}));

test("C6 · las reservas que ya existían cuestan lo mismo que antes", OPCIONES, (t) => conApi(t, null, async (api) => {
  const precios = await pistas(api);
  const todas = await listarTodas(api, "");
  assert.equal(todas.length, 525, "la semilla trae 525 reservas");
  for (const r of todas) {
    assert.equal(r.importe, precioDeSiempre(precios.get(r.pistaId)!, r.inicio), `${r.id} (${r.pistaId} ${r.inicio})`);
  }
}));
