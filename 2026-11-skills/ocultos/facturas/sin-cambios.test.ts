// Tests ocultos de la spec `facturas`: lo demás no cambia (C9). Reservar, cancelar y consultar reservas funciona igual
// que en la base `club/`, y estos tests tienen que pasar también contra ella. Caja negra: solo la API HTTP, con /_estado
// y /_reloj para preparar. De cada reserva se comparan los campos de la base: puede traer otros.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

const GESTOR = "socio-040";
const OPCIONES = { timeout: 30_000 };

interface Socio {
  id: string;
  cuotaActiva: boolean;
  rol: string;
}

interface Reserva {
  id: string;
  socioId: string;
  pistaId: string;
  inicio: string;
  fin: string;
  estado: string;
  importe: number;
  notas: string;
  penalizacion?: number;
  motivoCancelacion?: string;
}

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const abiertas = new Set<Api>();
after(() => abiertas.forEach((api) => api.cerrar()));

/** Una API solo para esta prueba, con la hora de la semilla (miércoles 18 de noviembre de 2026 a las 10:00). */
async function conApi(prueba: (api: Api) => Promise<void>) {
  const api = await arrancarApi({ TZ: "UTC" });
  abiertas.add(api);
  try {
    await prueba(api);
  } finally {
    api.cerrar();
    abiertas.delete(api);
  }
}

async function estadoDe(api: Api): Promise<{ ahora: string; socios: Socio[]; reservas: Reserva[] }> {
  return (await api.pedir("GET", "/_estado")).cuerpo;
}

/** Socios con la cuota al día, sin rol de gestor y sin reservas futuras, por id: pueden hacer tres reservas. */
async function sociosLibres(api: Api): Promise<string[]> {
  const { ahora, socios, reservas } = await estadoDe(api);
  const conFuturas = new Set(reservas.filter((r) => r.estado === "confirmada" && r.inicio > ahora).map((r) => r.socioId));
  return socios.filter((s) => s.cuotaActiva === true && s.rol === "socio" && !conFuturas.has(s.id)).map((s) => s.id).sort(comparar);
}

async function reloj(api: Api, ahora: string) {
  const r = await api.pedir("POST", "/_reloj", { cuerpo: { ahora } });
  assert.equal(r.status, 200, `mover el reloj a ${ahora}: ${r.texto}`);
}

function crear(api: Api, cuerpo: Record<string, unknown>, socio?: string) {
  return api.pedir("POST", "/api/reservas", { cuerpo, socio });
}

async function reservar(api: Api, socioId: string, pistaId: string, inicio: string): Promise<Reserva> {
  const r = await crear(api, { socioId, pistaId, inicio });
  assert.equal(r.status, 201, `reservar ${pistaId} el ${inicio} para ${socioId}: ${r.texto}`);
  return r.cuerpo.reserva;
}

function cancelar(api: Api, id: string, cuerpo: Record<string, unknown> = {}, socio?: string) {
  return api.pedir("POST", `/api/reservas/${id}/cancelar`, { cuerpo, socio });
}

function esError(r: Respuesta, http: number, codigo: string, contexto = "") {
  assert.equal(r.status, http, `${contexto} esperaba ${http} ${codigo} y llegó ${r.status}: ${r.texto.slice(0, 300)}`);
  assert.equal(r.cuerpo?.error?.codigo, codigo, `${contexto} ${r.texto.slice(0, 300)}`);
}

/** Los campos de la reserva en la base. */
function deLaReserva(r: Reserva) {
  return {
    id: r?.id,
    socioId: r?.socioId,
    pistaId: r?.pistaId,
    inicio: r?.inicio,
    fin: r?.fin,
    estado: r?.estado,
    importe: r?.importe,
    notas: r?.notas,
    penalizacion: r?.penalizacion,
    motivoCancelacion: r?.motivoCancelacion,
  };
}

/** Todas las reservas, página a página, como las lista GET /api/reservas. */
async function listarTodas(api: Api): Promise<ReturnType<typeof deLaReserva>[]> {
  const todas: ReturnType<typeof deLaReserva>[] = [];
  for (let pagina = 1; ; pagina++) {
    const r = await api.pedir("GET", `/api/reservas?limite=100&pagina=${pagina}`);
    assert.equal(r.status, 200, r.texto.slice(0, 300));
    todas.push(...r.cuerpo.reservas.map(deLaReserva));
    if (pagina >= r.cuerpo.paginas) return todas;
  }
}

test("C9 · reservar funciona igual: 201 con la reserva confirmada, su fin, su precio y sus notas, se llame con X-Socio o sin ella", OPCIONES, async () => {
  await conApi(async (api) => {
    const socios = await sociosLibres(api);
    const casos = [
      { pistaId: "pista-1", inicio: "2026-11-25T10:30", fin: "2026-11-25T12:00", importe: 1800, quien: () => undefined }, // miércoles por la mañana: valle
      { pistaId: "pista-2", inicio: "2026-11-26T18:00", fin: "2026-11-26T19:30", importe: 2800, notas: "Traen sus propias palas.", quien: (s: string) => s }, // desde las 18:00: punta
      { pistaId: "pista-3", inicio: "2026-11-28T09:00", fin: "2026-11-28T10:30", importe: 2000, quien: () => socios.at(-1) }, // sábado: punta
      { pistaId: "pista-3", inicio: "2026-11-27T13:30", fin: "2026-11-27T15:00", importe: 1200, quien: () => GESTOR }, // viernes a mediodía: valle
      { pistaId: "pista-1", inicio: "2026-11-27T21:00", fin: "2026-11-27T22:30", importe: 2800, quien: () => undefined }, // última franja
    ];
    for (const [i, caso] of casos.entries()) {
      const socioId = socios[i]!;
      const cuerpo = { socioId, pistaId: caso.pistaId, inicio: caso.inicio, ...(caso.notas ? { notas: caso.notas } : {}) };
      const r = await crear(api, cuerpo, caso.quien(socioId));
      assert.equal(r.status, 201, r.texto);
      const { reserva } = r.cuerpo;
      assert.equal(typeof reserva.id, "string");
      const campos = { socioId, pistaId: caso.pistaId, inicio: caso.inicio, fin: caso.fin, estado: "confirmada", importe: caso.importe, notas: caso.notas ?? "" };
      const deLaBase = (x: Reserva) => ({ socioId: x.socioId, pistaId: x.pistaId, inicio: x.inicio, fin: x.fin, estado: x.estado, importe: x.importe, notas: x.notas });
      assert.deepEqual(deLaBase(reserva), campos);
      const guardada = await api.pedir("GET", `/api/reservas/${reserva.id}`);
      assert.equal(guardada.status, 200, guardada.texto);
      assert.deepEqual(deLaReserva(guardada.cuerpo.reserva), deLaReserva(reserva));
      const dia = await api.pedir("GET", `/api/disponibilidad?fecha=${caso.inicio.slice(0, 10)}&pista=${caso.pistaId}`);
      const franja = dia.cuerpo.pistas[0].franjas.find((f: { inicio: string }) => f.inicio === caso.inicio);
      assert.deepEqual({ estado: franja.estado, precio: franja.precio, fin: franja.fin }, { estado: "reservada", precio: caso.importe, fin: caso.fin });
    }
  });
});

test("C9 · reservar mantiene sus errores", OPCIONES, async () => {
  await conApi(async (api) => {
    const [a, b] = await sociosLibres(api);
    const sinCuota = (await estadoDe(api)).socios.find((s) => s.cuotaActiva === false)!;
    const franja = { pistaId: "pista-1", inicio: "2026-11-25T10:30" };

    esError(await crear(api, {}), 400, "DATOS_INVALIDOS");
    esError(await crear(api, { ...franja, socioId: a, notas: 5 }), 400, "DATOS_INVALIDOS");
    esError(await crear(api, { ...franja, socioId: "socio-999" }), 404, "SOCIO_NO_ENCONTRADO");
    esError(await crear(api, { ...franja, socioId: a, pistaId: "pista-9" }), 404, "PISTA_NO_ENCONTRADA");
    esError(await crear(api, { ...franja, socioId: a, inicio: "2026-11-25T10:00" }), 400, "FRANJA_INVALIDA");
    esError(await crear(api, { ...franja, socioId: sinCuota.id }), 409, "CUOTA_INACTIVA");
    esError(await crear(api, { ...franja, socioId: a, pistaId: "pista-4" }), 409, "PISTA_CERRADA");
    esError(await crear(api, { ...franja, socioId: a, inicio: "2026-11-18T09:00" }), 409, "FRANJA_PASADA");
    esError(await crear(api, { ...franja, socioId: a, inicio: "2026-11-18T10:00" }), 400, "FRANJA_INVALIDA");

    assert.equal((await crear(api, { ...franja, socioId: a })).status, 201);
    esError(await crear(api, { ...franja, socioId: b }), 409, "FRANJA_NO_DISPONIBLE");
    assert.equal((await crear(api, { ...franja, socioId: a, pistaId: "pista-2" })).status, 201);
    assert.equal((await crear(api, { ...franja, socioId: a, pistaId: "pista-3" })).status, 201);
    esError(await crear(api, { socioId: a, pistaId: "pista-1", inicio: "2026-11-25T12:00" }), 409, "LIMITE_DE_RESERVAS");
  });
});

test("C9 · cancelar funciona igual: gratis hasta 24 horas antes y, después, solo con forzar y una penalización del 100 %, con sus errores", OPCIONES, async () => {
  await conApi(async (api) => {
    const estado = await estadoDe(api);
    const [a, b] = await sociosLibres(api);
    // Marta López juega el jueves 19 a las 09:00, en la pista 3 (12 €): faltan 23 horas.
    const marta = estado.reservas.find((r) => r.socioId === "socio-002" && r.inicio === "2026-11-19T09:00" && r.estado === "confirmada")!;
    assert.ok(marta, "la semilla trae la reserva de Marta López del jueves 19 a las 09:00");

    esError(await cancelar(api, marta.id), 409, "FUERA_DE_PLAZO", "a 23 horas sin forzar:");
    esError(await cancelar(api, marta.id, { forzar: "si" }), 400, "DATOS_INVALIDOS", "forzar que no es booleano:");
    const forzada = await cancelar(api, marta.id, { forzar: true, motivo: "Lesión" }, "socio-003");
    assert.equal(forzada.status, 200, forzada.texto);
    assert.deepEqual(deLaReserva(forzada.cuerpo.reserva), { ...deLaReserva(marta), estado: "cancelada", penalizacion: 1200, motivoCancelacion: "Lesión" });
    assert.deepEqual(deLaReserva((await api.pedir("GET", `/api/reservas/${marta.id}`)).cuerpo.reserva), deLaReserva(forzada.cuerpo.reserva));
    esError(await cancelar(api, marta.id, { forzar: true }), 409, "YA_CANCELADA", "otra vez:");

    // Con una semana de antelación, gratis, sin X-Socio.
    const holgada = await reservar(api, a, "pista-1", "2026-11-25T12:00");
    const gratis = await cancelar(api, holgada.id);
    assert.equal(gratis.status, 200, gratis.texto);
    assert.equal(gratis.cuerpo.reserva.estado, "cancelada");
    assert.equal(gratis.cuerpo.reserva.penalizacion ?? 0, 0);

    // A 24 horas justas todavía es gratis y no hace falta forzar. Cancela el gestor.
    const justa = await reservar(api, b, "pista-2", "2026-11-26T12:00");
    await reloj(api, "2026-11-25T12:00");
    const aTiempo = await cancelar(api, justa.id, {}, GESTOR);
    assert.equal(aTiempo.status, 200, aTiempo.texto);
    assert.equal(aTiempo.cuerpo.reserva.estado, "cancelada");
    assert.equal(aTiempo.cuerpo.reserva.penalizacion ?? 0, 0);

    // Una reserva que acaba de empezar y otra de octubre ya no se cancelan.
    const empieza = await reservar(api, b, "pista-3", "2026-11-25T13:30");
    await reloj(api, "2026-11-25T13:30");
    esError(await cancelar(api, empieza.id, { forzar: true }), 409, "RESERVA_PASADA", "a la hora de inicio:");
    const deOctubre = estado.reservas.find((r) => r.inicio.startsWith("2026-10") && r.estado === "confirmada")!;
    esError(await cancelar(api, deOctubre.id, { forzar: true }), 409, "RESERVA_PASADA", "de octubre:");
    esError(await cancelar(api, "R-9999"), 404, "RESERVA_NO_ENCONTRADA");
  });
});

test("C9 · consultar reservas funciona igual: filtros, paginación, una reserva por su id y sus errores", OPCIONES, async () => {
  await conApi(async (api) => {
    const estado = await estadoDe(api);
    // En la base, GET /api/reservas lista en el orden de la semilla: por inicio y, a la misma hora, por pista.
    const todas = [...estado.reservas].sort((a, b) => comparar(a.inicio, b.inicio) || comparar(a.pistaId, b.pistaId));
    assert.equal(todas.length, 525, "la semilla trae 525 reservas");
    const dia = (r: Reserva) => r.inicio.slice(0, 10);
    const consultas: [string, (r: Reserva) => boolean, number, number][] = [
      ["", () => true, 50, 1],
      ["?pagina=11", () => true, 50, 11],
      ["?pagina=12", () => true, 50, 12],
      ["?fecha=2026-10-15", (r) => dia(r) === "2026-10-15", 50, 1],
      ["?fecha=2026-10-15&desde=2026-10-01&hasta=2026-10-31", (r) => dia(r) === "2026-10-15", 50, 1],
      ["?desde=2026-10-01&hasta=2026-10-31&limite=100&pagina=2", (r) => dia(r) >= "2026-10-01" && dia(r) <= "2026-10-31", 100, 2],
      ["?desde=2026-11-17", (r) => dia(r) >= "2026-11-17", 50, 1],
      ["?hasta=2026-10-02", (r) => dia(r) <= "2026-10-02", 50, 1],
      ["?socio=socio-004&estado=cancelada", (r) => r.socioId === "socio-004" && r.estado === "cancelada", 50, 1],
      ["?pista=pista-4&estado=no_presentada", (r) => r.pistaId === "pista-4" && r.estado === "no_presentada", 50, 1],
      ["?estado=confirmada&limite=7&pagina=3", (r) => r.estado === "confirmada", 7, 3],
      ["?socio=socio-041", (r) => r.socioId === "socio-041", 50, 1],
    ];
    for (const [consulta, filtro, limite, pagina] of consultas) {
      const lista = todas.filter(filtro);
      const esperado = {
        total: lista.length,
        pagina,
        paginas: Math.max(1, Math.ceil(lista.length / limite)),
        reservas: lista.slice((pagina - 1) * limite, pagina * limite).map(deLaReserva),
      };
      for (const socio of [undefined, "socio-003", GESTOR]) {
        const r = await api.pedir("GET", `/api/reservas${consulta}`, { socio });
        assert.equal(r.status, 200, `${consulta}: ${r.texto.slice(0, 300)}`);
        const { total, pagina: p, paginas, reservas } = r.cuerpo;
        assert.deepEqual({ total, pagina: p, paginas, reservas: reservas.map(deLaReserva) }, esperado, `GET /api/reservas${consulta} con X-Socio ${socio}`);
      }
    }
    const octubre = await api.pedir("GET", "/api/reservas?desde=2026-10-01&hasta=2026-10-31&limite=1");
    assert.equal(octubre.cuerpo.total, 315);

    for (const r of [todas[0]!, todas.find((x) => x.estado === "cancelada")!, todas.find((x) => x.estado === "no_presentada")!, todas.at(-1)!]) {
      const una = await api.pedir("GET", `/api/reservas/${r.id}`);
      assert.equal(una.status, 200, una.texto);
      assert.deepEqual(deLaReserva(una.cuerpo.reserva), deLaReserva(r));
    }
    esError(await api.pedir("GET", "/api/reservas/R-9999"), 404, "RESERVA_NO_ENCONTRADA");
    for (const consulta of ["?fecha=2026-10", "?desde=15-10-2026", "?estado=pagada", "?limite=0", "?limite=101", "?limite=abc", "?pagina=0"]) {
      esError(await api.pedir("GET", `/api/reservas${consulta}`), 400, "DATOS_INVALIDOS", `${consulta}:`);
    }
  });
});

test("C9 · generar y consultar facturas no cambia las reservas, y después se sigue reservando y cancelando igual", OPCIONES, async () => {
  await conApi(async (api) => {
    const [a, b] = await sociosLibres(api);
    // Reservas nuevas fuera del orden de inicio, y una penalización en noviembre.
    await reservar(api, a, "pista-2", "2026-11-28T18:00");
    await reservar(api, b, "pista-1", "2026-11-25T10:30");
    const proxima = (await estadoDe(api)).reservas.find((r) => r.estado === "confirmada" && r.inicio > "2026-11-18T10:00" && r.inicio < "2026-11-19T10:00")!;
    assert.equal((await cancelar(api, proxima.id, { forzar: true })).status, 200);

    const antes = await listarTodas(api);
    const estadoAntes = (await estadoDe(api)).reservas.map(deLaReserva);
    await api.pedir("POST", "/api/facturas", { cuerpo: { mes: "2026-10" }, socio: GESTOR });
    await api.pedir("GET", "/api/facturas?mes=2026-10", { socio: GESTOR });
    await api.pedir("GET", "/api/facturas/F2026-0001", { socio: GESTOR });
    await reloj(api, "2026-12-02T10:00");
    await api.pedir("POST", "/api/facturas", { cuerpo: { mes: "2026-11" }, socio: GESTOR });
    await api.pedir("POST", "/api/facturas", { cuerpo: { mes: "2026-11" }, socio: GESTOR });
    await api.pedir("GET", "/api/facturas?mes=2026-11", { socio: GESTOR });

    assert.deepEqual(await listarTodas(api), antes, "GET /api/reservas, página a página, después de facturar");
    assert.deepEqual((await estadoDe(api)).reservas.map(deLaReserva), estadoAntes, "las reservas de /_estado después de facturar");

    const nueva = await crear(api, { socioId: a, pistaId: "pista-1", inicio: "2026-12-10T18:00" }, a);
    assert.equal(nueva.status, 201, nueva.texto);
    assert.deepEqual(
      { estado: nueva.cuerpo.reserva.estado, importe: nueva.cuerpo.reserva.importe, fin: nueva.cuerpo.reserva.fin },
      { estado: "confirmada", importe: 2800, fin: "2026-12-10T19:30" },
    );
    const cancelada = await cancelar(api, nueva.cuerpo.reserva.id);
    assert.equal(cancelada.status, 200, cancelada.texto);
    assert.equal(cancelada.cuerpo.reserva.penalizacion ?? 0, 0);
    const pasada = antes.find((r) => r.inicio.startsWith("2026-11-2") && r.estado === "confirmada")!;
    esError(await cancelar(api, pasada.id!), 409, "RESERVA_PASADA", "una reserva de noviembre, con el reloj en diciembre:");
  });
});
