// Penalizaciones escalonadas, exención e informe de caja (docs/specs/reembolsos.md), probados a través de la API.
import assert from "node:assert/strict";
import { test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

const GESTOR = "socio-040";
const MOTIVO = "Lesión del socio, con parte médico";

/** Arranca una API con la hora del club en `ahora` y la cierra al terminar la prueba. */
async function conApi(ahora: string, prueba: (api: Api) => Promise<void>) {
  const api = await arrancarApi({ AHORA: ahora });
  try {
    await prueba(api);
  } finally {
    api.cerrar();
  }
}

async function reservar(api: Api, socioId: string, pistaId: string, inicio: string): Promise<{ id: string; importe: number }> {
  const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio } });
  assert.equal(r.status, 201, `reservar ${pistaId} el ${inicio}: ${r.texto}`);
  return r.cuerpo.reserva;
}

async function moverReloj(api: Api, ahora: string) {
  assert.equal((await api.pedir("POST", "/_reloj", { cuerpo: { ahora } })).status, 200);
}

function cancelar(api: Api, id: string, cuerpo: Record<string, unknown> = {}, socio?: string) {
  return api.pedir("POST", `/api/reservas/${id}/cancelar`, { cuerpo, socio });
}

test("tramos: con 48 horas o más no hay penalización, con 24 o más es el 25 % y con menos, solo con forzar y el 50 %", async () => {
  await conApi("2027-02-01T10:00", async (api) => {
    const holgada = await reservar(api, "socio-003", "pista-1", "2027-02-11T10:30");
    const tardia = await reservar(api, "socio-003", "pista-3", "2027-02-10T09:00");
    const urgente = await reservar(api, "socio-003", "pista-2", "2027-02-08T19:30");
    await moverReloj(api, "2027-02-08T10:30");

    const sinPenalizacion = await cancelar(api, holgada.id);
    assert.equal(sinPenalizacion.status, 200);
    assert.equal(sinPenalizacion.cuerpo.reserva.estado, "cancelada");
    assert.equal(sinPenalizacion.cuerpo.reserva.penalizacion, undefined);
    assert.equal(sinPenalizacion.cuerpo.reembolso, 1800);

    // 46,5 horas: el 25 % de 12 €.
    const conPenalizacion = await cancelar(api, tardia.id);
    assert.equal(conPenalizacion.cuerpo.reserva.penalizacion, 300);
    assert.equal(conPenalizacion.cuerpo.reembolso, 900);

    // 9 horas: sin forzar no se cancela; con forzar, el 50 % de 28 €.
    const sinForzar = await cancelar(api, urgente.id);
    assert.equal(sinForzar.status, 409);
    assert.equal(sinForzar.cuerpo.error.codigo, "FUERA_DE_PLAZO");
    const forzada = await cancelar(api, urgente.id, { forzar: true });
    assert.equal(forzada.cuerpo.reserva.penalizacion, 1400);
    assert.equal(forzada.cuerpo.reembolso, 1400);
  });
});

test("límites: a 48 horas justas no hay penalización y a 24 horas justas es el 25 % sin forzar", async () => {
  await conApi("2027-02-01T10:00", async (api) => {
    const a48 = await reservar(api, "socio-003", "pista-1", "2027-02-10T10:30");
    const a24 = await reservar(api, "socio-003", "pista-1", "2027-02-09T10:30");
    const casi48 = await reservar(api, "socio-004", "pista-2", "2027-02-10T10:30");
    const casi24 = await reservar(api, "socio-004", "pista-2", "2027-02-09T10:30");

    await moverReloj(api, "2027-02-08T10:30");
    assert.equal((await cancelar(api, a48.id)).cuerpo.reserva.penalizacion, undefined);
    const justas24 = await cancelar(api, a24.id);
    assert.equal(justas24.status, 200);
    assert.equal(justas24.cuerpo.reserva.penalizacion, 450);

    // Un minuto después: 47 h 59 min ya es el 25 % y 23 h 59 min ya pide forzar.
    await moverReloj(api, "2027-02-08T10:31");
    assert.equal((await cancelar(api, casi48.id)).cuerpo.reserva.penalizacion, 450);
    assert.equal((await cancelar(api, casi24.id)).cuerpo.error.codigo, "FUERA_DE_PLAZO");
  });
});

test("cambio de hora: del 26 de marzo de 2027 a las 20:30 al 28 a las 21:00 hay 47,5 horas reales", async () => {
  await conApi("2027-03-20T10:00", async (api) => {
    const domingo = await reservar(api, "socio-003", "pista-1", "2027-03-28T21:00");
    const otra = await reservar(api, "socio-004", "pista-2", "2027-03-28T21:00");

    await moverReloj(api, "2027-03-26T20:30");
    assert.equal((await cancelar(api, domingo.id)).cuerpo.reserva.penalizacion, 700);

    // El sábado a las 20:30 faltan 23,5 horas reales, aunque el reloj marque 24,5.
    await moverReloj(api, "2027-03-27T20:30");
    assert.equal((await cancelar(api, otra.id)).cuerpo.error.codigo, "FUERA_DE_PLAZO");
    assert.equal((await cancelar(api, otra.id, { forzar: true })).cuerpo.reserva.penalizacion, 1400);
  });
});

test("cambio de hora: al volver al horario de invierno, del 29 de octubre de 2027 a las 21:30 al 31 a las 21:00 hay 48,5 horas", async () => {
  await conApi("2027-10-20T10:00", async (api) => {
    const domingo = await reservar(api, "socio-003", "pista-1", "2027-10-31T21:00");
    const otra = await reservar(api, "socio-004", "pista-2", "2027-10-31T21:00");

    await moverReloj(api, "2027-10-29T21:30");
    assert.equal((await cancelar(api, domingo.id)).cuerpo.reserva.penalizacion, undefined);

    // El sábado a las 21:30 faltan 24,5 horas reales: el 25 % sin forzar.
    await moverReloj(api, "2027-10-30T21:30");
    const tardia = await cancelar(api, otra.id);
    assert.equal(tardia.status, 200);
    assert.equal(tardia.cuerpo.reserva.penalizacion, 700);
  });
});

test("exención: un gestor cancela sin penalización ni forzar hasta el último minuto, y el motivo queda guardado", async () => {
  await conApi("2027-02-01T10:00", async (api) => {
    const reserva = await reservar(api, "socio-003", "pista-1", "2027-02-08T12:00");
    await moverReloj(api, "2027-02-08T11:59");
    const exenta = await cancelar(api, reserva.id, { exento: true, motivo: MOTIVO }, GESTOR);
    assert.equal(exenta.status, 200);
    assert.equal(exenta.cuerpo.reserva.estado, "cancelada");
    assert.equal(exenta.cuerpo.reserva.penalizacion, undefined);
    assert.equal(exenta.cuerpo.reserva.motivoCancelacion, MOTIVO);
    assert.equal(exenta.cuerpo.reembolso, 1800);
  });
});

test("exención: hace falta un gestor identificado y un motivo de al menos 10 caracteres", async () => {
  await conApi("2027-02-01T10:00", async (api) => {
    const reserva = await reservar(api, "socio-003", "pista-1", "2027-02-09T13:30");
    await moverReloj(api, "2027-02-08T10:30");
    const rechazos: [Record<string, unknown>, string | undefined, number, string][] = [
      [{ exento: true, motivo: MOTIVO }, undefined, 401, "NO_IDENTIFICADO"],
      [{ exento: true, motivo: MOTIVO }, "socio-003", 403, "SIN_PERMISO"],
      [{ exento: true }, GESTOR, 400, "DATOS_INVALIDOS"],
      [{ exento: true, motivo: "Lesionado" }, GESTOR, 400, "DATOS_INVALIDOS"],
    ];
    for (const [cuerpo, socio, http, codigo] of rechazos) {
      const r = await cancelar(api, reserva.id, cuerpo, socio);
      assert.equal(r.status, http, JSON.stringify(cuerpo));
      assert.equal(r.cuerpo.error.codigo, codigo);
    }
    assert.equal((await api.pedir("GET", `/api/reservas/${reserva.id}`)).cuerpo.reserva.estado, "confirmada");
    const justo = await cancelar(api, reserva.id, { exento: true, motivo: "Lesionado." }, GESTOR);
    assert.equal(justo.status, 200);
    assert.equal(justo.cuerpo.reserva.penalizacion, undefined);
  });
});

test("una reserva que ya ha empezado no se cancela, tampoco con exento", async () => {
  await conApi("2027-02-01T10:00", async (api) => {
    const reserva = await reservar(api, "socio-003", "pista-1", "2027-02-10T12:00");
    for (const ahora of ["2027-02-10T12:00", "2027-02-10T12:45", "2027-02-11T09:00"]) {
      await moverReloj(api, ahora);
      for (const [cuerpo, socio] of [[{ forzar: true }, undefined], [{ exento: true, motivo: MOTIVO }, GESTOR]] as const) {
        const r = await cancelar(api, reserva.id, cuerpo, socio);
        assert.equal(r.status, 409);
        assert.equal(r.cuerpo.error.codigo, "RESERVA_PASADA");
      }
    }
  });
});

test("informe de caja: solo para gestores y con un mes AAAA-MM", async () => {
  await conApi("2026-11-18T10:00", async (api) => {
    const anonimo = await api.pedir("GET", "/api/informes/caja?mes=2026-10");
    assert.equal(anonimo.status, 401);
    assert.equal(anonimo.cuerpo.error.codigo, "NO_IDENTIFICADO");
    const socio = await api.pedir("GET", "/api/informes/caja?mes=2026-10", { socio: "socio-003" });
    assert.equal(socio.status, 403);
    assert.equal(socio.cuerpo.error.codigo, "SIN_PERMISO");
    for (const ruta of ["/api/informes/caja?mes=2026-1", "/api/informes/caja?mes=2026-13", "/api/informes/caja?mes=2026-10-01", "/api/informes/caja"]) {
      const r = await api.pedir("GET", ruta, { socio: GESTOR });
      assert.equal(r.status, 400, ruta);
      assert.equal(r.cuerpo.error.codigo, "DATOS_INVALIDOS");
    }
  });
});

test("informe de caja de octubre de 2026: una entrada por pista, ordenadas por id, que cuadra con las reservas", async () => {
  await conApi("2026-11-18T10:00", async (api) => {
    const { reservas } = (await api.pedir("GET", "/_estado")).cuerpo as { reservas: { pistaId: string; inicio: string; estado: string; importe: number }[] };
    const informe = await api.pedir("GET", "/api/informes/caja?mes=2026-10", { socio: GESTOR });
    assert.equal(informe.status, 200);
    assert.equal(informe.cuerpo.mes, "2026-10");
    assert.deepEqual(informe.cuerpo.pistas.map((p: { pistaId: string }) => p.pistaId), ["pista-1", "pista-2", "pista-3", "pista-4"]);
    for (const fila of informe.cuerpo.pistas) {
      const cobradas = reservas.filter((r) => r.pistaId === fila.pistaId && r.inicio.startsWith("2026-10") && r.estado !== "cancelada");
      assert.equal(fila.reservas, cobradas.length);
      assert.equal(fila.ingresos, cobradas.reduce((suma, r) => suma + r.importe, 0));
      assert.equal(fila.penalizaciones, 0, "las canceladas de la semilla no tienen penalización");
      assert.equal(fila.total, fila.ingresos);
    }
    // 315 reservas en octubre, 25 de ellas canceladas.
    assert.equal(informe.cuerpo.total.reservas, 290);
  });
});

test("informe de caja: suma las penalizaciones por el mes de inicio y lista también las pistas sin movimientos", async () => {
  await conApi("2027-01-25T10:00", async (api) => {
    await reservar(api, "socio-003", "pista-3", "2027-02-03T19:30");
    const enero = await reservar(api, "socio-003", "pista-3", "2027-01-31T21:00");
    const gratis = await reservar(api, "socio-003", "pista-1", "2027-02-03T12:00");
    const tardia = await reservar(api, "socio-004", "pista-1", "2027-02-04T09:00");
    const urgente = await reservar(api, "socio-004", "pista-1", "2027-02-03T18:00");
    await reservar(api, "socio-004", "pista-3", "2027-02-28T21:00");
    const marzo = await reservar(api, "socio-041", "pista-1", "2027-03-01T09:00");

    await moverReloj(api, "2027-01-31T10:00");
    await cancelar(api, enero.id, { forzar: true }); // 1000
    await moverReloj(api, "2027-02-01T10:00");
    await cancelar(api, gratis.id); // sin penalización
    await moverReloj(api, "2027-02-03T08:00");
    await cancelar(api, tardia.id); // 450
    await cancelar(api, urgente.id, { forzar: true }); // 1400
    await moverReloj(api, "2027-02-28T22:00");
    await cancelar(api, marzo.id, { forzar: true }); // 900
    await moverReloj(api, "2027-03-02T10:00");

    const febrero = await api.pedir("GET", "/api/informes/caja?mes=2027-02", { socio: GESTOR });
    assert.equal(febrero.status, 200);
    assert.deepEqual(febrero.cuerpo, {
      mes: "2027-02",
      pistas: [
        { pistaId: "pista-1", reservas: 0, ingresos: 0, penalizaciones: 1850, total: 1850 },
        { pistaId: "pista-2", reservas: 0, ingresos: 0, penalizaciones: 0, total: 0 },
        { pistaId: "pista-3", reservas: 2, ingresos: 4000, penalizaciones: 0, total: 4000 },
        { pistaId: "pista-4", reservas: 0, ingresos: 0, penalizaciones: 0, total: 0 },
      ],
      total: { reservas: 2, ingresos: 4000, penalizaciones: 1850, total: 5850 },
    });
    const totalDe = async (mes: string) => (await api.pedir("GET", `/api/informes/caja?mes=${mes}`, { socio: GESTOR })).cuerpo.total;
    assert.deepEqual(await totalDe("2027-01"), { reservas: 0, ingresos: 0, penalizaciones: 1000, total: 1000 });
    assert.deepEqual(await totalDe("2027-03"), { reservas: 0, ingresos: 0, penalizaciones: 900, total: 900 });
  });
});

test("las reservas ya canceladas conservan su penalización y no se vuelven a cancelar", async () => {
  await conApi("2027-02-01T10:00", async (api) => {
    const reserva = await reservar(api, "socio-003", "pista-2", "2027-02-03T19:30");
    await moverReloj(api, "2027-02-03T09:30");
    assert.equal((await cancelar(api, reserva.id, { forzar: true })).cuerpo.reserva.penalizacion, 1400);

    // Dos días antes ya no habría penalización, pero la reserva ya está cancelada.
    await moverReloj(api, "2027-02-01T10:00");
    for (const [cuerpo, socio] of [[{}, undefined], [{ exento: true, motivo: MOTIVO }, GESTOR]] as const) {
      const r = await cancelar(api, reserva.id, cuerpo, socio);
      assert.equal(r.status, 409);
      assert.equal(r.cuerpo.error.codigo, "YA_CANCELADA");
    }
    assert.equal((await api.pedir("GET", `/api/reservas/${reserva.id}`)).cuerpo.reserva.penalizacion, 1400);
  });
});
