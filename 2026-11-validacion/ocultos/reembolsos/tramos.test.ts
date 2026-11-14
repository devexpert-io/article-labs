// Tests ocultos de la spec `reembolsos`: tramos (C1), límites exactos (C2), cambio de hora (C3) y reembolso (C4).
// Caja negra: solo la API HTTP, con /_estado y /_reloj para preparar. Cada prueba arranca su propia API.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

const GESTOR = "socio-040";
const MOTIVO = "Lesión de rodilla con parte médico";
const OPCIONES = { timeout: 30_000 };

interface Reserva {
  id: string;
  socioId: string;
  importe: number;
  estado: string;
  penalizacion?: number;
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
    /** Cancela como el socio de la reserva. */
    cancelar(reserva: Reserva, cuerpo: Record<string, unknown> = {}) {
      return api.pedir("POST", `/api/reservas/${reserva.id}/cancelar`, { cuerpo, socio: reserva.socioId });
    },
    cancelarComo(socio: string, reserva: Reserva, cuerpo: Record<string, unknown>) {
      return api.pedir("POST", `/api/reservas/${reserva.id}/cancelar`, { cuerpo, socio });
    },
    async consultar(reserva: Reserva): Promise<Reserva> {
      const r = await api.pedir("GET", `/api/reservas/${reserva.id}`);
      assert.equal(r.status, 200, r.texto);
      return r.cuerpo.reserva;
    },
  };
}

function esError(r: Respuesta, http: number, codigo: string) {
  assert.equal(r.status, http, `esperaba ${http} ${codigo} y llegó ${r.status}: ${r.texto}`);
  assert.equal(r.cuerpo?.error?.codigo, codigo, r.texto);
}

/** Comprueba que la respuesta de cancelar es un 200 con la reserva cancelada y la devuelve. */
function cancelada(r: Respuesta): Reserva {
  assert.equal(r.status, 200, `esperaba 200 al cancelar y llegó ${r.status}: ${r.texto}`);
  assert.equal(r.cuerpo?.reserva?.estado, "cancelada", r.texto);
  return r.cuerpo.reserva;
}

/** Sin penalización vale tanto sin el campo como con 0. */
function sinPenalizacion(reserva: Reserva) {
  assert.equal(reserva.penalizacion ?? 0, 0, `no debía tener penalización: ${JSON.stringify(reserva)}`);
}

function conPenalizacion(porcentaje: number, original: Reserva, reserva: Reserva) {
  assert.equal(reserva.penalizacion, (original.importe * porcentaje) / 100, `esperaba el ${porcentaje} % de ${original.importe}: ${JSON.stringify(reserva)}`);
}

test("C1 · con 48 horas o más no hay penalización y con 24 horas o más, y menos de 48, es el 25 % del importe", OPCIONES, async () => {
  await conClub("2027-02-01T10:00", async (club) => {
    const holgada = await club.reservar("pista-1", "2027-02-12T19:30"); // 105 h
    const dosDias = await club.reservar("pista-3", "2027-02-10T12:00"); // 49,5 h
    const tardia = await club.reservar("pista-3", "2027-02-10T09:00"); // 46,5 h, aunque sea dos días después
    const otraTardia = await club.reservar("pista-2", "2027-02-09T12:00"); // 25,5 h
    await club.reloj("2027-02-08T10:30");
    sinPenalizacion(cancelada(await club.cancelar(holgada)));
    sinPenalizacion(cancelada(await club.cancelar(dosDias)));
    conPenalizacion(25, tardia, cancelada(await club.cancelar(tardia)));
    conPenalizacion(25, otraTardia, cancelada(await club.cancelar(otraTardia)));
  });
});

test("C1 · con menos de 24 horas solo se cancela con forzar: true (sin él, 409 FUERA_DE_PLAZO) y la penalización es el 50 %", OPCIONES, async () => {
  await conClub("2027-02-01T10:00", async (club) => {
    const hoy = await club.reservar("pista-2", "2027-02-08T18:00"); // 7,5 h
    const manana = await club.reservar("pista-3", "2027-02-09T09:00"); // 22,5 h
    await club.reloj("2027-02-08T10:30");
    for (const reserva of [hoy, manana]) {
      esError(await club.cancelar(reserva), 409, "FUERA_DE_PLAZO");
      esError(await club.cancelar(reserva, { forzar: false }), 409, "FUERA_DE_PLAZO");
      assert.equal((await club.consultar(reserva)).estado, "confirmada");
      conPenalizacion(50, reserva, cancelada(await club.cancelar(reserva, { forzar: true })));
    }
  });
});

test("C1 · forzar no cambia la penalización cuando faltan 24 horas o más", OPCIONES, async () => {
  await conClub("2027-02-01T10:00", async (club) => {
    const holgada = await club.reservar("pista-1", "2027-02-11T10:30"); // 72 h
    const tardia = await club.reservar("pista-2", "2027-02-09T13:30"); // 27 h
    await club.reloj("2027-02-08T10:30");
    sinPenalizacion(cancelada(await club.cancelar(holgada, { forzar: true })));
    conPenalizacion(25, tardia, cancelada(await club.cancelar(tardia, { forzar: true })));
  });
});

test("C2 · a 48 horas justas no hay penalización (y a 47 h 59 min ya es el 25 %)", OPCIONES, async () => {
  await conClub("2027-02-01T10:00", async (club) => {
    const justas = await club.reservar("pista-1", "2027-02-10T10:30");
    const casi = await club.reservar("pista-2", "2027-02-10T10:30");
    await club.reloj("2027-02-08T10:30");
    sinPenalizacion(cancelada(await club.cancelar(justas)));
    await club.reloj("2027-02-08T10:31");
    conPenalizacion(25, casi, cancelada(await club.cancelar(casi)));
  });
});

test("C2 · a 24 horas justas se aplica el 25 % sin forzar (y a 23 h 59 min ya hace falta forzar)", OPCIONES, async () => {
  await conClub("2027-02-01T10:00", async (club) => {
    const justas = await club.reservar("pista-1", "2027-02-09T10:30");
    const casi = await club.reservar("pista-2", "2027-02-09T10:30");
    await club.reloj("2027-02-08T10:30");
    conPenalizacion(25, justas, cancelada(await club.cancelar(justas)));
    await club.reloj("2027-02-08T10:31");
    esError(await club.cancelar(casi), 409, "FUERA_DE_PLAZO");
    conPenalizacion(50, casi, cancelada(await club.cancelar(casi, { forzar: true })));
  });
});

test("C3 · del viernes 26 de marzo de 2027 a las 20:30 al domingo 28 a las 21:00 hay 47,5 horas reales: el 25 %", OPCIONES, async () => {
  await conClub("2027-03-20T10:00", async (club) => {
    const domingo = await club.reservar("pista-1", "2027-03-28T21:00");
    await club.reloj("2027-03-26T20:30");
    conPenalizacion(25, domingo, cancelada(await club.cancelar(domingo)));
  });
});

test("C3 · del sábado 27 de marzo de 2027 a las 20:30 al domingo 28 a las 21:00 hay 23,5 horas reales: solo con forzar y el 50 %", OPCIONES, async () => {
  await conClub("2027-03-20T10:00", async (club) => {
    const domingo = await club.reservar("pista-2", "2027-03-28T21:00");
    await club.reloj("2027-03-27T20:30");
    esError(await club.cancelar(domingo), 409, "FUERA_DE_PLAZO");
    conPenalizacion(50, domingo, cancelada(await club.cancelar(domingo, { forzar: true })));
  });
});

test("C3 · al volver al horario de invierno (31 de octubre de 2027) hay 48,5 y 24,5 horas reales donde el reloj marca 47,5 y 23,5", OPCIONES, async () => {
  await conClub("2027-10-20T10:00", async (club) => {
    const holgada = await club.reservar("pista-1", "2027-10-31T21:00");
    const tardia = await club.reservar("pista-2", "2027-10-31T21:00");
    await club.reloj("2027-10-29T21:30");
    sinPenalizacion(cancelada(await club.cancelar(holgada)));
    await club.reloj("2027-10-30T21:30");
    conPenalizacion(25, tardia, cancelada(await club.cancelar(tardia)));
  });
});

test("C4 · la respuesta de cancelar incluye reembolso, igual a importe - penalizacion (el importe entero si no hay penalización)", OPCIONES, async () => {
  await conClub("2027-02-01T10:00", async (club) => {
    const holgada = await club.reservar("pista-1", "2027-02-11T10:30"); // 72 h
    const tardia = await club.reservar("pista-2", "2027-02-09T19:30"); // 33 h
    const urgente = await club.reservar("pista-3", "2027-02-08T19:30"); // 9 h
    const exenta = await club.reservar("pista-1", "2027-02-09T12:00"); // 25,5 h
    await club.reloj("2027-02-08T10:30");
    const cuadra = (original: Reserva, r: Respuesta) => {
      const reserva = cancelada(r);
      assert.equal(typeof r.cuerpo.reembolso, "number", `falta reembolso en la respuesta: ${r.texto}`);
      assert.equal(r.cuerpo.reembolso, original.importe - (reserva.penalizacion ?? 0), r.texto);
    };
    cuadra(holgada, await club.cancelar(holgada));
    cuadra(tardia, await club.cancelar(tardia));
    cuadra(urgente, await club.cancelar(urgente, { forzar: true }));
    // La exención se prueba en C5. Aquí solo importa que, si se acepta, su reembolso también cuadre.
    const exencion = await club.cancelarComo(GESTOR, exenta, { exento: true, motivo: MOTIVO });
    if (exencion.status === 200) cuadra(exenta, exencion);
  });
});
