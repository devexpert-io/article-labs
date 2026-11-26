// Tests ocultos de la spec `reembolsos`: exención de un gestor (C5) y reservas que ya han empezado (C6).
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
  motivoCancelacion?: string;
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
    /** Cancela como `socio`, o sin cabecera X-Socio si es undefined. */
    cancelarComo(socio: string | undefined, reserva: Reserva, cuerpo: Record<string, unknown>) {
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

test("C5 · un gestor cancela con exento: true y un motivo, sin penalización ni forzar, en cualquier momento antes del inicio, y el motivo se guarda", OPCIONES, async () => {
  await conClub("2027-02-01T10:00", async (club) => {
    const tardia = await club.reservar("pista-1", "2027-02-09T13:30"); // a las 10:30 del día 8 faltan 27 h: sin exención, el 25 %
    const ultima = await club.reservar("pista-2", "2027-02-08T12:00"); // a las 11:59 falta un minuto
    const otroMotivo = "Avería en la iluminación de la pista";

    await club.reloj("2027-02-08T10:30");
    const primera = cancelada(await club.cancelarComo(GESTOR, tardia, { exento: true, motivo: MOTIVO }));
    sinPenalizacion(primera);
    assert.equal(primera.motivoCancelacion, MOTIVO);

    await club.reloj("2027-02-08T11:59");
    const segunda = cancelada(await club.cancelarComo(GESTOR, ultima, { exento: true, motivo: otroMotivo }));
    sinPenalizacion(segunda);
    assert.equal(segunda.motivoCancelacion, otroMotivo);

    for (const [reserva, motivo] of [[tardia, MOTIVO], [ultima, otroMotivo]] as const) {
      const guardada = await club.consultar(reserva);
      assert.equal(guardada.estado, "cancelada");
      sinPenalizacion(guardada);
      assert.equal(guardada.motivoCancelacion, motivo);
    }
  });
});

test("C5 · sin motivo o con uno de menos de 10 caracteres, 400 DATOS_INVALIDOS (con 10 justos, sí)", OPCIONES, async () => {
  await conClub("2027-02-01T10:00", async (club) => {
    const reserva = await club.reservar("pista-1", "2027-02-09T13:30");
    await club.reloj("2027-02-08T10:30");
    esError(await club.cancelarComo(GESTOR, reserva, { exento: true }), 400, "DATOS_INVALIDOS");
    esError(await club.cancelarComo(GESTOR, reserva, { exento: true, motivo: "" }), 400, "DATOS_INVALIDOS");
    esError(await club.cancelarComo(GESTOR, reserva, { exento: true, motivo: "Lesionado" }), 400, "DATOS_INVALIDOS");
    assert.equal((await club.consultar(reserva)).estado, "confirmada");
    const diez = cancelada(await club.cancelarComo(GESTOR, reserva, { exento: true, motivo: "Lesionado." }));
    sinPenalizacion(diez);
    assert.equal(diez.motivoCancelacion, "Lesionado.");
  });
});

test("C5 · si quien pide la exención no es gestor, 403 SIN_PERMISO, y si no se sabe quién es, 401 NO_IDENTIFICADO", OPCIONES, async () => {
  await conClub("2027-02-01T10:00", async (club) => {
    const reserva = await club.reservar("pista-1", "2027-02-09T13:30");
    await club.reloj("2027-02-08T10:30");
    esError(await club.cancelarComo(reserva.socioId, reserva, { exento: true, motivo: MOTIVO }), 403, "SIN_PERMISO");
    esError(await club.cancelarComo(undefined, reserva, { exento: true, motivo: MOTIVO }), 401, "NO_IDENTIFICADO");
    esError(await club.cancelarComo("socio-999", reserva, { exento: true, motivo: MOTIVO }), 401, "NO_IDENTIFICADO");
    const intacta = await club.consultar(reserva);
    assert.equal(intacta.estado, "confirmada");
    sinPenalizacion(intacta);
  });
});

test("C6 · una reserva que ya ha empezado no se cancela (409 RESERVA_PASADA), tampoco con exento", OPCIONES, async () => {
  await conClub("2027-02-01T10:00", async (club) => {
    const reserva = await club.reservar("pista-1", "2027-02-10T12:00");
    for (const ahora of ["2027-02-10T12:45", "2027-02-11T10:00"]) {
      await club.reloj(ahora);
      esError(await club.cancelar(reserva), 409, "RESERVA_PASADA");
      esError(await club.cancelar(reserva, { forzar: true }), 409, "RESERVA_PASADA");
      esError(await club.cancelarComo(GESTOR, reserva, { exento: true, motivo: MOTIVO }), 409, "RESERVA_PASADA");
      esError(await club.cancelarComo(GESTOR, reserva, { exento: true, forzar: true, motivo: MOTIVO }), 409, "RESERVA_PASADA");
    }
    assert.equal((await club.consultar(reserva)).estado, "confirmada");
  });
});

test("C6 · a la hora de inicio la reserva ya ha empezado: 409 RESERVA_PASADA, también con exento", OPCIONES, async () => {
  await conClub("2027-02-01T10:00", async (club) => {
    const reserva = await club.reservar("pista-2", "2027-02-10T12:00");
    await club.reloj("2027-02-10T12:00");
    esError(await club.cancelarComo(GESTOR, reserva, { exento: true, motivo: MOTIVO }), 409, "RESERVA_PASADA");
    esError(await club.cancelar(reserva, { forzar: true }), 409, "RESERVA_PASADA");
    assert.equal((await club.consultar(reserva)).estado, "confirmada");
  });
});
