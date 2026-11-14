// Tests ocultos de la spec codigos-descuento: el código CLUB10 (C4).
// Caja negra: solo la API HTTP, /_estado y /_reloj. Cada test arranca su propia API.
// Se mueve el reloj a diciembre, sin reservas en la semilla: todas las franjas libres y nadie con reservas futuras.
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

async function sociosLibres(api: Api, cuantos: number): Promise<string[]> {
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  const ids = estado.socios
    .filter((s: any) => s.cuotaActiva === true && s.id !== "socio-040" && s.id !== "socio-041")
    .filter((s: any) => !estado.reservas.some((r: any) => r.socioId === s.id && r.estado === "confirmada" && r.inicio > estado.ahora))
    .map((s: any) => s.id);
  assert.ok(ids.length >= cuantos, `hacen falta ${cuantos} socios con la cuota al día`);
  return ids.slice(0, cuantos);
}

/** Reserva con CLUB10 en la pista 1, en hora valle (18,00 €), y comprueba el descuento. */
async function club10Valle(api: Api, socioId: string, inicio: string): Promise<string> {
  const r = await reservar(api, { socioId, pistaId: "pista-1", inicio, codigo: "CLUB10" });
  assert.equal(r.status, 201, `${inicio} ${r.texto}`);
  assert.deepEqual(importes(r.cuerpo.reserva), { importeBase: 1800, descuento: 180, importe: 1620, codigo: "CLUB10" }, inicio);
  return r.cuerpo.reserva.id;
}

// Lunes 7 de diciembre de 2026, antes de la primera franja.
const DICIEMBRE = "2026-12-07T08:00";

test("C4 · CLUB10 descuenta el 10 % en cualquier franja", () =>
  conApi(async (api) => {
    const [a, b, c] = await sociosLibres(api, 3);
    const sabado = await reservar(api, { socioId: a, pistaId: "pista-1", inicio: "2026-12-12T18:00", codigo: "CLUB10" });
    assert.equal(sabado.status, 201, sabado.texto);
    assert.deepEqual(importes(sabado.cuerpo.reserva), { importeBase: 2800, descuento: 280, importe: 2520, codigo: "CLUB10" });
    const lunes = await reservar(api, { socioId: b, pistaId: "pista-3", inicio: "2026-12-07T13:30", codigo: "CLUB10" });
    assert.equal(lunes.status, 201, lunes.texto);
    assert.deepEqual(importes(lunes.cuerpo.reserva), { importeBase: 1200, descuento: 120, importe: 1080, codigo: "CLUB10" });
    const domingo = await reservar(api, { socioId: c, pistaId: "pista-3", inicio: "2026-12-13T21:00", codigo: "CLUB10" });
    assert.equal(domingo.status, 201, domingo.texto);
    assert.deepEqual(importes(domingo.cuerpo.reserva), { importeBase: 2000, descuento: 200, importe: 1800, codigo: "CLUB10" });
  }, DICIEMBRE));

test("C4 · CLUB10 no vale si el socio ya tiene 3 reservas con él, aunque ya se hayan jugado", () =>
  conApi(async (api) => {
    const [a] = await sociosLibres(api, 1);
    for (const inicio of ["2026-12-07T13:30", "2026-12-07T15:00", "2026-12-07T16:30"]) await club10Valle(api, a!, inicio);
    // Las tres ya han pasado y siguen confirmadas: cuentan, y el socio no tiene reservas futuras.
    await mover(api, "2026-12-07T20:00");
    const antes = await totalDe(api, a!);
    error(await reservar(api, { socioId: a, pistaId: "pista-1", inicio: "2026-12-08T13:30", codigo: "CLUB10" }), 409, "CODIGO_NO_APLICABLE");
    assert.equal(await totalDe(api, a!), antes, "con el código rechazado no se crea la reserva");
    // Sin código, la misma reserva sí se puede hacer.
    const sinCodigo = await reservar(api, { socioId: a, pistaId: "pista-1", inicio: "2026-12-08T13:30" });
    assert.equal(sinCodigo.status, 201, sinCodigo.texto);
  }, DICIEMBRE));

test("C4 · las reservas canceladas no cuentan para el límite de CLUB10", () =>
  conApi(async (api) => {
    const [a] = await sociosLibres(api, 1);
    const ids: string[] = [];
    for (const inicio of ["2026-12-09T13:30", "2026-12-09T15:00", "2026-12-09T16:30"]) ids.push(await club10Valle(api, a!, inicio));
    // Faltan más de 24 horas: se cancela gratis.
    const cancelada = await api.pedir("POST", `/api/reservas/${ids[0]}/cancelar`);
    assert.equal(cancelada.status, 200, cancelada.texto);
    await club10Valle(api, a!, "2026-12-10T13:30");
  }, DICIEMBRE));

test("C4 · el límite de CLUB10 es de cada socio", () =>
  conApi(async (api) => {
    const [a, b] = await sociosLibres(api, 2);
    for (const inicio of ["2026-12-09T13:30", "2026-12-09T15:00", "2026-12-09T16:30"]) await club10Valle(api, a!, inicio);
    await club10Valle(api, b!, "2026-12-10T13:30");
  }, DICIEMBRE));

test("C4 · solo cuentan las reservas hechas con CLUB10", () =>
  conApi(async (api) => {
    // Tres reservas con otros códigos (BIENVENIDA y MANANAS) que ya han pasado: no cuentan para CLUB10.
    await reservar(api, { socioId: "socio-041", pistaId: "pista-1", inicio: "2026-12-07T09:00", codigo: "BIENVENIDA" });
    for (const inicio of ["2026-12-08T09:00", "2026-12-09T09:00"]) {
      await reservar(api, { socioId: "socio-041", pistaId: "pista-1", inicio, codigo: "MANANAS" });
    }
    await mover(api, "2026-12-09T20:00");
    await club10Valle(api, "socio-041", "2026-12-10T13:30");
  }, DICIEMBRE));
