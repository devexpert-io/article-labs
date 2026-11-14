// Tests ocultos de la spec `reembolsos`: informe de caja (C7).
// Caja negra: solo la API HTTP, con /_estado y /_reloj para preparar. Lo esperado se calcula en el test a partir de /_estado.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

const GESTOR = "socio-040";
const SOCIO = "socio-003";
const OPCIONES = { timeout: 30_000 };

interface Reserva {
  id: string;
  socioId: string;
  pistaId: string;
  inicio: string;
  estado: string;
  importe: number;
  penalizacion?: number;
}

interface Cifras {
  reservas: number;
  ingresos: number;
  penalizaciones: number;
  total: number;
}

const abiertas = new Set<Api>();
after(() => abiertas.forEach((api) => api.cerrar()));

/** Una API solo para esta prueba, en UTC para que la zona horaria del sistema no tape el cambio de hora. */
async function conClub(ahora: string, prueba: (club: ReturnType<typeof crearClub>) => Promise<void>) {
  const api = await arrancarApi({ AHORA: ahora, TZ: "UTC" });
  abiertas.add(api);
  try {
    await prueba(crearClub(api));
  } finally {
    api.cerrar();
    abiertas.delete(api);
  }
}

function crearClub(api: Api) {
  let socios: string[] = [];
  let turno = 0;
  return {
    /** Reserva con el siguiente socio con la cuota al día, para que nadie llegue al límite de reservas futuras. */
    async reservar(pistaId: string, inicio: string): Promise<Reserva> {
      if (socios.length === 0) {
        const estado = (await api.pedir("GET", "/_estado")).cuerpo;
        socios = estado.socios.filter((s: any) => s.cuotaActiva === true && s.rol === "socio").map((s: any) => s.id);
      }
      for (let intento = 0; intento < socios.length; intento++) {
        const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: socios[turno++ % socios.length], pistaId, inicio } });
        if (r.status === 201) return r.cuerpo.reserva;
        if (r.cuerpo?.error?.codigo !== "LIMITE_DE_RESERVAS") assert.fail(`No se pudo reservar ${pistaId} el ${inicio}: ${r.status} ${r.texto}`);
      }
      assert.fail(`No se pudo reservar ${pistaId} el ${inicio}: todos los socios están en el límite`);
    },
    async reloj(ahora: string) {
      const r = await api.pedir("POST", "/_reloj", { cuerpo: { ahora } });
      assert.equal(r.status, 200, `mover el reloj a ${ahora}: ${r.texto}`);
    },
    /** Cancela como el socio de la reserva. Aquí no se comprueba el resultado: los tramos son de C1 a C3. */
    cancelar(reserva: Reserva, cuerpo: Record<string, unknown> = {}) {
      return api.pedir("POST", `/api/reservas/${reserva.id}/cancelar`, { cuerpo, socio: reserva.socioId });
    },
    informe(mes: string, socio?: string) {
      return api.pedir("GET", `/api/informes/caja?mes=${encodeURIComponent(mes)}`, { socio });
    },
    async estado(): Promise<{ pistas: { id: string }[]; reservas: Reserva[] }> {
      return (await api.pedir("GET", "/_estado")).cuerpo;
    },
  };
}

function esError(r: Respuesta, http: number, codigo: string, contexto = "") {
  assert.equal(r.status, http, `${contexto} esperaba ${http} ${codigo} y llegó ${r.status}: ${r.texto}`);
  assert.equal(r.cuerpo?.error?.codigo, codigo, `${contexto} ${r.texto}`);
}

/** El informe que pide la spec, calculado a partir de las reservas de /_estado. */
function esperado(estado: { pistas: { id: string }[]; reservas: Reserva[] }, mes: string) {
  const total: Cifras = { reservas: 0, ingresos: 0, penalizaciones: 0, total: 0 };
  const pistas = estado.pistas.map((p) => p.id).sort().map((pistaId) => {
    const fila = { pistaId, reservas: 0, ingresos: 0, penalizaciones: 0, total: 0 };
    for (const r of estado.reservas) {
      if (r.pistaId !== pistaId || r.inicio.slice(0, 7) !== mes) continue;
      if (r.estado === "confirmada" || r.estado === "no_presentada") {
        fila.reservas += 1;
        fila.ingresos += r.importe;
      }
      if (r.estado === "cancelada") fila.penalizaciones += r.penalizacion ?? 0;
    }
    fila.total = fila.ingresos + fila.penalizaciones;
    for (const campo of ["reservas", "ingresos", "penalizaciones", "total"] as const) total[campo] += fila[campo];
    return fila;
  });
  return { mes, pistas, total };
}

/** Del informe, solo los campos que fija la spec: puede traer otros. */
function recortar(informe: any) {
  const cifras = (c: any) => ({ reservas: c?.reservas, ingresos: c?.ingresos, penalizaciones: c?.penalizaciones, total: c?.total });
  return {
    mes: informe?.mes,
    pistas: Array.isArray(informe?.pistas) ? informe.pistas.map((p: any) => ({ pistaId: p?.pistaId, ...cifras(p) })) : informe?.pistas,
    total: cifras(informe?.total),
  };
}

async function cuadra(club: ReturnType<typeof crearClub>, mes: string) {
  const estado = await club.estado();
  const r = await club.informe(mes, GESTOR);
  assert.equal(r.status, 200, `informe de ${mes}: ${r.texto}`);
  assert.deepEqual(recortar(r.cuerpo), esperado(estado, mes), `informe de ${mes}`);
}

test("C7 · el informe de caja es solo para gestores: 401 NO_IDENTIFICADO sin X-Socio y 403 SIN_PERMISO si no es gestor", OPCIONES, async () => {
  await conClub("2026-11-18T10:00", async (club) => {
    esError(await club.informe("2026-10"), 401, "NO_IDENTIFICADO");
    esError(await club.informe("2026-10", SOCIO), 403, "SIN_PERMISO");
    assert.equal((await club.informe("2026-10", GESTOR)).status, 200);
  });
});

test("C7 · octubre de 2026: una entrada por pista, ordenadas por id, con reservas, ingresos, penalizaciones y total que cuadran con el estado", OPCIONES, async () => {
  await conClub("2026-11-18T10:00", async (club) => {
    await cuadra(club, "2026-10");
  });
});

test("C7 · suma las penalizaciones de las canceladas que empiezan en el mes, sin contar sus importes, y lista las pistas sin movimientos", OPCIONES, async () => {
  await conClub("2027-01-25T10:00", async (club) => {
    // La primera reserva del mes es de la pista 3: el orden no puede salir del orden de las reservas.
    await club.reservar("pista-3", "2027-02-03T19:30");
    const enero = await club.reservar("pista-3", "2027-01-31T21:00");
    const gratis = await club.reservar("pista-1", "2027-02-03T12:00");
    const tardia = await club.reservar("pista-1", "2027-02-04T09:00");
    const urgente = await club.reservar("pista-1", "2027-02-03T18:00");
    await club.reservar("pista-3", "2027-02-28T21:00");
    const marzo = await club.reservar("pista-1", "2027-03-01T09:00");

    await club.reloj("2027-01-31T10:00");
    await club.cancelar(enero, { forzar: true });
    await club.reloj("2027-02-01T10:00");
    await club.cancelar(gratis);
    await club.reloj("2027-02-03T08:00");
    await club.cancelar(tardia);
    await club.cancelar(urgente, { forzar: true });
    await club.reloj("2027-02-28T22:00");
    await club.cancelar(marzo, { forzar: true });
    await club.reloj("2027-03-02T10:00");

    for (const mes of ["2027-01", "2027-02", "2027-03"]) await cuadra(club, mes);
  });
});

test("C7 · un mes sin reservas lista todas las pistas del club, con todo a cero", OPCIONES, async () => {
  await conClub("2026-11-18T10:00", async (club) => {
    await cuadra(club, "2027-06");
  });
});

test("C7 · con un mes que no tiene el formato AAAA-MM, 400 DATOS_INVALIDOS", OPCIONES, async () => {
  await conClub("2026-11-18T10:00", async (club) => {
    for (const mes of ["2026-1", "2026/10", "octubre", "2026-10-01", "10-2026", "202610"]) {
      esError(await club.informe(mes, GESTOR), 400, "DATOS_INVALIDOS", `mes=${mes}:`);
    }
  });
});
