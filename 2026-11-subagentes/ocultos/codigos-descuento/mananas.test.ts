// Tests ocultos de la spec codigos-descuento: el código MANANAS (C3).
// Caja negra: solo la API HTTP, /_estado y /_reloj. Cada test arranca su propia API.
// Se mueve el reloj a fechas sin reservas en la semilla: todas las franjas libres y nadie con reservas futuras.
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
const mover = async (api: Api, ahora: string) =>
  assert.equal((await api.pedir("POST", "/_reloj", { cuerpo: { ahora } })).status, 200, "POST /_reloj");

function error(r: Respuesta, http: number, codigo: string, contexto = ""): void {
  assert.equal(r.status, http, `${contexto} ${r.texto}`);
  assert.equal(r.cuerpo?.error?.codigo, codigo, `${contexto} ${r.texto}`);
}

function importes(reserva: any) {
  return { importeBase: reserva?.importeBase, descuento: reserva?.descuento, importe: reserva?.importe, codigo: reserva?.codigo };
}

async function totalDe(api: Api, socioId: string): Promise<number> {
  const r = await api.pedir("GET", `/api/reservas?socio=${socioId}&limite=1`);
  assert.equal(r.status, 200, r.texto);
  return r.cuerpo.total;
}

/** Socios con la cuota al día y sin reservas futuras, según /_estado (sin socio-040 ni socio-041). */
async function sociosLibres(api: Api, cuantos: number): Promise<string[]> {
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  const ids = estado.socios
    .filter((s: any) => s.cuotaActiva === true && s.id !== "socio-040" && s.id !== "socio-041")
    .filter((s: any) => !estado.reservas.some((r: any) => r.socioId === s.id && r.estado === "confirmada" && r.inicio > estado.ahora))
    .map((s: any) => s.id);
  assert.ok(ids.length >= cuantos, `hacen falta ${cuantos} socios con la cuota al día`);
  return ids.slice(0, cuantos);
}

// Lunes 7 de diciembre de 2026, antes de la primera franja.
const DICIEMBRE = "2026-12-07T08:00";

test("C3 · MANANAS descuenta 4,00 € en franjas de lunes a viernes que empiezan antes de las 12:00", () =>
  conApi(async (api) => {
    const [a, b, c] = await sociosLibres(api, 3);
    const lunes = await reservar(api, { socioId: a, pistaId: "pista-1", inicio: "2026-12-07T09:00", codigo: "MANANAS" });
    assert.equal(lunes.status, 201, lunes.texto);
    assert.deepEqual(importes(lunes.cuerpo.reserva), { importeBase: 1800, descuento: 400, importe: 1400, codigo: "MANANAS" });
    const miercoles = await reservar(api, { socioId: b, pistaId: "pista-3", inicio: "2026-12-09T10:30", codigo: "MANANAS" });
    assert.equal(miercoles.status, 201, miercoles.texto);
    assert.deepEqual(importes(miercoles.cuerpo.reserva), { importeBase: 1200, descuento: 400, importe: 800, codigo: "MANANAS" });
    const viernes = await reservar(api, { socioId: c, pistaId: "pista-2", inicio: "2026-12-11T09:00", codigo: "MANANAS" });
    assert.equal(viernes.status, 201, viernes.texto);
    assert.deepEqual(importes(viernes.cuerpo.reserva), { importeBase: 1800, descuento: 400, importe: 1400, codigo: "MANANAS" });
  }, DICIEMBRE));

test("C3 · MANANAS no vale entre semana en franjas que empiezan a las 12:00 o más tarde", () =>
  conApi(async (api) => {
    const [a] = await sociosLibres(api, 1);
    const antes = await totalDe(api, a!);
    for (const inicio of ["2026-12-07T12:00", "2026-12-08T13:30", "2026-12-09T16:30", "2026-12-10T18:00", "2026-12-11T21:00"]) {
      error(await reservar(api, { socioId: a, pistaId: "pista-1", inicio, codigo: "MANANAS" }), 409, "CODIGO_NO_APLICABLE", inicio);
    }
    assert.equal(await totalDe(api, a!), antes, "con el código rechazado no se crea la reserva");
  }, DICIEMBRE));

test("C3 · MANANAS no vale el sábado ni el domingo, tampoco por la mañana", () =>
  conApi(async (api) => {
    const [a] = await sociosLibres(api, 1);
    const antes = await totalDe(api, a!);
    for (const inicio of ["2026-12-12T09:00", "2026-12-12T10:30", "2026-12-13T09:00", "2026-12-13T10:30"]) {
      error(await reservar(api, { socioId: a, pistaId: "pista-1", inicio, codigo: "MANANAS" }), 409, "CODIGO_NO_APLICABLE", inicio);
    }
    assert.equal(await totalDe(api, a!), antes, "con el código rechazado no se crea la reserva");
  }, DICIEMBRE));

test("C3 · MANANAS no caduca ni tiene límite de usos", () =>
  conApi(async (api) => {
    // Marzo de 2027: pasada la fecha de BIENVENIDA. El mismo socio lo usa cinco veces.
    const [a] = await sociosLibres(api, 1);
    const usar = async (inicio: string) => {
      const r = await reservar(api, { socioId: a, pistaId: "pista-1", inicio, codigo: "MANANAS" });
      assert.equal(r.status, 201, `${inicio} ${r.texto}`);
      assert.deepEqual(importes(r.cuerpo.reserva), { importeBase: 1800, descuento: 400, importe: 1400, codigo: "MANANAS" }, inicio);
    };
    for (const inicio of ["2027-03-01T09:00", "2027-03-02T09:00", "2027-03-03T10:30"]) await usar(inicio);
    // Esas tres ya han pasado: el socio vuelve a tener sitio para reservas futuras.
    await mover(api, "2027-03-04T08:00");
    for (const inicio of ["2027-03-04T09:00", "2027-03-05T10:30"]) await usar(inicio);
  }, "2027-03-01T08:00"));
