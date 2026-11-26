// Tests ocultos de la spec `reembolsos`: lo demás no cambia (C8). Lo esperado es lo que hace la base `club/`,
// y estos tests tienen que pasar también contra ella. Caja negra: solo la API HTTP, con /_estado y /_reloj para preparar.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

const GESTOR = "socio-040";
const MOTIVO = "Lesión de rodilla con parte médico";
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
}

const abiertas = new Set<Api>();
after(() => abiertas.forEach((api) => api.cerrar()));

/** Una API solo para esta prueba, en UTC para que la zona horaria del sistema no influya. */
async function conApi(ahora: string, prueba: (api: Api) => Promise<void>) {
  const api = await arrancarApi({ AHORA: ahora, TZ: "UTC" });
  abiertas.add(api);
  try {
    await prueba(api);
  } finally {
    api.cerrar();
    abiertas.delete(api);
  }
}

async function estadoDe(api: Api): Promise<{ socios: Socio[]; reservas: Reserva[] }> {
  return (await api.pedir("GET", "/_estado")).cuerpo;
}

/** Socios con la cuota al día y sin rol de gestor. */
async function sociosActivos(api: Api): Promise<string[]> {
  return (await estadoDe(api)).socios.filter((s) => s.cuotaActiva === true && s.rol === "socio").map((s) => s.id);
}

async function reloj(api: Api, ahora: string) {
  const r = await api.pedir("POST", "/_reloj", { cuerpo: { ahora } });
  assert.equal(r.status, 200, `mover el reloj a ${ahora}: ${r.texto}`);
}

function crear(api: Api, cuerpo: Record<string, unknown>) {
  return api.pedir("POST", "/api/reservas", { cuerpo });
}

function cancelarComo(api: Api, socio: string | undefined, id: string, cuerpo: Record<string, unknown> = {}) {
  return api.pedir("POST", `/api/reservas/${id}/cancelar`, { cuerpo, socio });
}

function esError(r: Respuesta, http: number, codigo: string, contexto = "") {
  assert.equal(r.status, http, `${contexto} esperaba ${http} ${codigo} y llegó ${r.status}: ${r.texto}`);
  assert.equal(r.cuerpo?.error?.codigo, codigo, `${contexto} ${r.texto}`);
}

test("C8 · crear reservas funciona igual: 201 con la reserva confirmada, su fin, su precio y sus notas", OPCIONES, async () => {
  await conApi("2027-02-01T10:00", async (api) => {
    const socios = await sociosActivos(api);
    const casos = [
      { pistaId: "pista-1", inicio: "2027-02-03T10:30", fin: "2027-02-03T12:00", importe: 1800 }, // miércoles por la mañana: valle
      { pistaId: "pista-2", inicio: "2027-02-04T18:00", fin: "2027-02-04T19:30", importe: 2800, notas: "Traen sus propias palas." }, // desde las 18:00: punta
      { pistaId: "pista-3", inicio: "2027-02-06T09:00", fin: "2027-02-06T10:30", importe: 2000 }, // sábado: punta
      { pistaId: "pista-3", inicio: "2027-02-05T13:30", fin: "2027-02-05T15:00", importe: 1200 }, // viernes a mediodía: valle
      { pistaId: "pista-1", inicio: "2027-02-05T21:00", fin: "2027-02-05T22:30", importe: 2800 }, // última franja
    ];
    for (const [i, caso] of casos.entries()) {
      const socioId = socios[i]!;
      const r = await crear(api, { socioId, pistaId: caso.pistaId, inicio: caso.inicio, ...(caso.notas ? { notas: caso.notas } : {}) });
      assert.equal(r.status, 201, r.texto);
      const { reserva } = r.cuerpo;
      assert.equal(typeof reserva.id, "string");
      const campos = { socioId, pistaId: caso.pistaId, inicio: caso.inicio, fin: caso.fin, estado: "confirmada", importe: caso.importe, notas: caso.notas ?? "" };
      const deLaReserva = (x: Reserva) => ({ socioId: x.socioId, pistaId: x.pistaId, inicio: x.inicio, fin: x.fin, estado: x.estado, importe: x.importe, notas: x.notas });
      assert.deepEqual(deLaReserva(reserva), campos);
      const guardada = await api.pedir("GET", `/api/reservas/${reserva.id}`);
      assert.deepEqual(deLaReserva(guardada.cuerpo.reserva), campos);
    }
    const dia = await api.pedir("GET", "/api/disponibilidad?fecha=2027-02-03&pista=pista-1");
    assert.equal(dia.cuerpo.pistas[0].franjas.find((f: { inicio: string }) => f.inicio === "2027-02-03T10:30").estado, "reservada");
  });
});

test("C8 · crear reservas mantiene sus errores", OPCIONES, async () => {
  await conApi("2027-02-01T10:00", async (api) => {
    const estado = await estadoDe(api);
    const [a, b] = estado.socios.filter((s) => s.cuotaActiva === true && s.rol === "socio").map((s) => s.id);
    const sinCuota = estado.socios.find((s) => s.cuotaActiva === false);
    const franja = { pistaId: "pista-1", inicio: "2027-02-03T10:30" };

    esError(await crear(api, {}), 400, "DATOS_INVALIDOS");
    esError(await crear(api, { ...franja, socioId: "socio-999" }), 404, "SOCIO_NO_ENCONTRADO");
    esError(await crear(api, { ...franja, socioId: a, pistaId: "pista-9" }), 404, "PISTA_NO_ENCONTRADA");
    esError(await crear(api, { ...franja, socioId: a, inicio: "2027-02-03T10:00" }), 400, "FRANJA_INVALIDA");
    if (sinCuota) esError(await crear(api, { ...franja, socioId: sinCuota.id }), 409, "CUOTA_INACTIVA");
    esError(await crear(api, { ...franja, socioId: a, pistaId: "pista-4" }), 409, "PISTA_CERRADA");
    esError(await crear(api, { ...franja, socioId: a, inicio: "2027-02-01T09:00" }), 409, "FRANJA_PASADA");

    assert.equal((await crear(api, { ...franja, socioId: a })).status, 201);
    esError(await crear(api, { ...franja, socioId: b }), 409, "FRANJA_NO_DISPONIBLE");
    assert.equal((await crear(api, { ...franja, socioId: a, pistaId: "pista-2" })).status, 201);
    assert.equal((await crear(api, { ...franja, socioId: a, pistaId: "pista-3" })).status, 201);
    esError(await crear(api, { socioId: a, pistaId: "pista-1", inicio: "2027-02-03T12:00" }), 409, "LIMITE_DE_RESERVAS");
  });
});

test("C8 · las reservas que ya estaban canceladas en la semilla conservan su penalización", OPCIONES, async () => {
  await conApi("2026-11-18T10:00", async (api) => {
    const canceladas = (await estadoDe(api)).reservas.filter((r) => r.estado === "cancelada");
    assert.ok(canceladas.length > 0, "la semilla trae reservas canceladas");
    // Un día antes de la primera, para que lo único que impida cancelarlas sea que ya están canceladas.
    const primera = canceladas.map((r) => r.inicio).sort()[0]!;
    await reloj(api, new Date(Date.parse(`${primera}:00Z`) - 86_400_000).toISOString().slice(0, 16));
    for (const r of canceladas) {
      esError(await cancelarComo(api, r.socioId, r.id), 409, "YA_CANCELADA", r.id);
      esError(await cancelarComo(api, r.socioId, r.id, { forzar: true }), 409, "YA_CANCELADA", r.id);
      esError(await cancelarComo(api, GESTOR, r.id, { exento: true, motivo: MOTIVO }), 409, "YA_CANCELADA", r.id);
    }
    for (const mes of ["2026-10", "2026-11"]) await api.pedir("GET", `/api/informes/caja?mes=${mes}`, { socio: GESTOR });
    await reloj(api, "2026-11-18T10:00");
    const despues = new Map((await estadoDe(api)).reservas.map((r) => [r.id, r]));
    for (const r of canceladas) {
      assert.equal(despues.get(r.id)?.estado, "cancelada", r.id);
      assert.equal(despues.get(r.id)?.penalizacion ?? 0, r.penalizacion ?? 0, r.id);
    }
  });
});

test("C8 · una reserva cancelada conserva su penalización: no se vuelve a cancelar ni cambia al mover el reloj", OPCIONES, async () => {
  await conApi("2027-02-01T10:00", async (api) => {
    const [socio] = await sociosActivos(api);
    const creada = await crear(api, { socioId: socio, pistaId: "pista-2", inicio: "2027-02-03T19:30" });
    assert.equal(creada.status, 201, creada.texto);
    const id: string = creada.cuerpo.reserva.id;
    await reloj(api, "2027-02-03T09:30");
    // La cuantía es de C1. Aquí solo importa que, sea cual sea, no cambie.
    const forzada = await cancelarComo(api, socio, id, { forzar: true });
    assert.equal(forzada.status, 200, forzada.texto);
    const penalizacion = forzada.cuerpo.reserva.penalizacion;

    // Dos días antes ya no habría penalización, pero la reserva ya estaba cancelada.
    await reloj(api, "2027-02-01T10:00");
    esError(await cancelarComo(api, socio, id), 409, "YA_CANCELADA");
    esError(await cancelarComo(api, GESTOR, id, { exento: true, motivo: MOTIVO }), 409, "YA_CANCELADA");
    for (const ahora of ["2027-02-01T10:00", "2027-02-05T10:00"]) {
      await reloj(api, ahora);
      const guardada = (await api.pedir("GET", `/api/reservas/${id}`)).cuerpo.reserva;
      assert.equal(guardada.estado, "cancelada");
      assert.equal(guardada.penalizacion, penalizacion);
    }
  });
});

test("C8 · cualquiera sigue pudiendo cancelar, sin X-Socio o con la de otro socio", OPCIONES, async () => {
  await conApi("2027-02-01T10:00", async (api) => {
    const [a, b, otro] = await sociosActivos(api);
    const primera = await crear(api, { socioId: a, pistaId: "pista-1", inicio: "2027-02-10T10:30" });
    const segunda = await crear(api, { socioId: b, pistaId: "pista-2", inicio: "2027-02-10T10:30" });
    for (const [r, quien] of [[primera, undefined], [segunda, otro]] as const) {
      assert.equal(r.status, 201, r.texto);
      const c = await cancelarComo(api, quien, r.cuerpo.reserva.id);
      assert.equal(c.status, 200, c.texto);
      assert.equal(c.cuerpo.reserva.estado, "cancelada");
    }
  });
});
