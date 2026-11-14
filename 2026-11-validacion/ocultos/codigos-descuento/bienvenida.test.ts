// Tests ocultos de la spec codigos-descuento: el código BIENVENIDA (C2).
// Caja negra: solo la API HTTP, /_estado y /_reloj. Cada test arranca su propia API.
// En la semilla, socio-041 es la única sin reservas. En diciembre ya han pasado todas las reservas de la semilla.
import assert from "node:assert/strict";
import { test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

async function conApi(prueba: (api: Api) => Promise<void>, ahora?: string): Promise<void> {
  const api = await arrancarApi();
  try {
    if (ahora) assert.equal((await api.pedir("POST", "/_reloj", { cuerpo: { ahora } })).status, 200, "POST /_reloj");
    await prueba(api);
  } finally {
    api.cerrar();
  }
}

const reservar = (api: Api, cuerpo: Record<string, unknown>) => api.pedir("POST", "/api/reservas", { cuerpo });

function error(r: Respuesta, http: number, codigo: string, contexto = ""): void {
  assert.equal(r.status, http, `${contexto} ${r.texto}`);
  assert.equal(r.cuerpo?.error?.codigo, codigo, `${contexto} ${r.texto}`);
}

function importes(reserva: any) {
  return { importeBase: reserva?.importeBase, descuento: reserva?.descuento, importe: reserva?.importe, codigo: reserva?.codigo };
}

/** Cuántas reservas tiene el socio, en cualquier estado. */
async function totalDe(api: Api, socioId: string): Promise<number> {
  const r = await api.pedir("GET", `/api/reservas?socio=${socioId}&limite=1`);
  assert.equal(r.status, 200, r.texto);
  return r.cuerpo.total;
}

// Lunes 7 de diciembre de 2026, antes de la primera franja: nadie tiene reservas futuras.
const DICIEMBRE = "2026-12-07T08:00";

test("C2 · BIENVENIDA descuenta el 50 % en la primera reserva del socio", async () => {
  await conApi(async (api) => {
    // Jueves 19 a las 19:30, pista 2: libre y en hora punta (28,00 €).
    const r = await reservar(api, { socioId: "socio-041", pistaId: "pista-2", inicio: "2026-11-19T19:30", codigo: "BIENVENIDA" });
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual(importes(r.cuerpo.reserva), { importeBase: 2800, descuento: 1400, importe: 1400, codigo: "BIENVENIDA" });
  });
  await conApi(async (api) => {
    // Miércoles 9 de diciembre a las 13:30, pista 3: hora valle (12,00 €).
    const r = await reservar(api, { socioId: "socio-041", pistaId: "pista-3", inicio: "2026-12-09T13:30", codigo: "BIENVENIDA" });
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual(importes(r.cuerpo.reserva), { importeBase: 1200, descuento: 600, importe: 600, codigo: "BIENVENIDA" });
  }, DICIEMBRE);
});

test("C2 · BIENVENIDA no vale para un socio que ya tiene reservas, aunque ya hayan pasado", () =>
  conApi(async (api) => {
    const estado = (await api.pedir("GET", "/_estado")).cuerpo;
    const activos = estado.socios.filter((s: any) => s.cuotaActiva === true && s.id !== "socio-041").map((s: any) => s.id);
    let socio: string | undefined;
    for (const id of activos) {
      if ((await totalDe(api, id)) > 0) {
        socio = id;
        break;
      }
    }
    assert.ok(socio, "hace falta un socio con la cuota al día y reservas");
    const antes = await totalDe(api, socio);
    const r = await reservar(api, { socioId: socio, pistaId: "pista-3", inicio: "2026-12-09T13:30", codigo: "BIENVENIDA" });
    error(r, 409, "CODIGO_NO_APLICABLE", socio);
    assert.equal(await totalDe(api, socio), antes, "con el código rechazado no se crea la reserva");
  }, DICIEMBRE));

test("C2 · BIENVENIDA mira las reservas del socio de la reserva, no las de quien llama", () =>
  conApi(async (api) => {
    // socio-041 llama (X-Socio) para reservar a nombre de un socio con reservas: no es la primera reserva de ese socio.
    assert.ok((await totalDe(api, "socio-003")) > 0, "socio-003 tiene reservas en la semilla");
    const ajena = await api.pedir("POST", "/api/reservas", {
      socio: "socio-041",
      cuerpo: { socioId: "socio-003", pistaId: "pista-3", inicio: "2026-11-24T12:00", codigo: "BIENVENIDA" },
    });
    error(ajena, 409, "CODIGO_NO_APLICABLE");
    // La recepción (socio-040) reserva para socio-041, que no tiene ninguna: vale.
    const recepcion = await api.pedir("POST", "/api/reservas", {
      socio: "socio-040",
      cuerpo: { socioId: "socio-041", pistaId: "pista-2", inicio: "2026-11-19T19:30", codigo: "BIENVENIDA" },
    });
    assert.equal(recepcion.status, 201, recepcion.texto);
    assert.deepEqual(importes(recepcion.cuerpo.reserva), { importeBase: 2800, descuento: 1400, importe: 1400, codigo: "BIENVENIDA" });
  }));

test("C2 · BIENVENIDA no vale en la segunda reserva del socio", () =>
  conApi(async (api) => {
    const primera = await reservar(api, { socioId: "socio-041", pistaId: "pista-2", inicio: "2026-11-19T19:30", codigo: "BIENVENIDA" });
    assert.equal(primera.status, 201, primera.texto);
    const segunda = await reservar(api, { socioId: "socio-041", pistaId: "pista-3", inicio: "2026-11-19T19:30", codigo: "BIENVENIDA" });
    error(segunda, 409, "CODIGO_NO_APLICABLE");
    assert.equal(await totalDe(api, "socio-041"), 1, "con el código rechazado no se crea la reserva");
  }));

test("C2 · BIENVENIDA no vale si el socio ya tiene una reserva hecha sin código", () =>
  conApi(async (api) => {
    const sinCodigo = await reservar(api, { socioId: "socio-041", pistaId: "pista-1", inicio: "2026-12-09T13:30" });
    assert.equal(sinCodigo.status, 201, sinCodigo.texto);
    const r = await reservar(api, { socioId: "socio-041", pistaId: "pista-1", inicio: "2026-12-10T13:30", codigo: "BIENVENIDA" });
    error(r, 409, "CODIGO_NO_APLICABLE");
  }, DICIEMBRE));

test("C2 · BIENVENIDA no vale si la única reserva del socio está cancelada", () =>
  conApi(async (api) => {
    const sinCodigo = await reservar(api, { socioId: "socio-041", pistaId: "pista-1", inicio: "2026-12-09T13:30" });
    assert.equal(sinCodigo.status, 201, sinCodigo.texto);
    const cancelada = await api.pedir("POST", `/api/reservas/${sinCodigo.cuerpo.reserva.id}/cancelar`);
    assert.equal(cancelada.status, 200, cancelada.texto);
    const r = await reservar(api, { socioId: "socio-041", pistaId: "pista-1", inicio: "2026-12-10T13:30", codigo: "BIENVENIDA" });
    error(r, 409, "CODIGO_NO_APLICABLE");
  }, DICIEMBRE));

test("C2 · BIENVENIDA vale en reservas hechas hasta el 31 de diciembre de 2026 incluido, según la hora del club", () =>
  conApi(async (api) => {
    // Último minuto de 2026 en el club; la franja ya es de 2027 (lunes 4 de enero a las 13:30, hora valle).
    const r = await reservar(api, { socioId: "socio-041", pistaId: "pista-1", inicio: "2027-01-04T13:30", codigo: "BIENVENIDA" });
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual(importes(r.cuerpo.reserva), { importeBase: 1800, descuento: 900, importe: 900, codigo: "BIENVENIDA" });
  }, "2026-12-31T23:59"));

test("C2 · BIENVENIDA no vale si la hora del club es posterior al 31 de diciembre de 2026", () =>
  conApi(async (api) => {
    const r = await reservar(api, { socioId: "socio-041", pistaId: "pista-1", inicio: "2027-01-04T13:30", codigo: "BIENVENIDA" });
    error(r, 409, "CODIGO_NO_APLICABLE");
    assert.equal(await totalDe(api, "socio-041"), 0, "con el código rechazado no se crea la reserva");
  }, "2027-01-01T00:00"));
