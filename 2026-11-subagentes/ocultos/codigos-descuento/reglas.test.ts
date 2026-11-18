// Tests ocultos de la spec codigos-descuento: las reglas del club van primero y el código no cuenta como usado (C8).
// Caja negra: solo la API HTTP, /_estado y /_reloj. Cada test arranca su propia API.
// De la semilla solo se usa lo estable: pista 4 cerrada, pista 1 ocupada y pistas 2 y 3 libres el jueves 19 a las 19:30,
// socio-041 sin reservas y algún socio con la cuota inactiva (se busca en /_estado).
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

// Lunes 7 de diciembre de 2026, antes de la primera franja: no hay reservas en la semilla.
const DICIEMBRE = "2026-12-07T08:00";

test("C8 · si la reserva no se puede hacer se responde ese error y BIENVENIDA no cuenta como usado", () =>
  conApi(async (api) => {
    const con = (pistaId: string, inicio: string) => reservar(api, { socioId: "socio-041", pistaId, inicio, codigo: "BIENVENIDA" });
    error(await con("pista-4", "2026-11-21T16:30"), 409, "PISTA_CERRADA");
    error(await con("pista-2", "2026-11-18T09:00"), 409, "FRANJA_PASADA");
    error(await con("pista-1", "2026-11-19T19:30"), 409, "FRANJA_NO_DISPONIBLE");
    error(await con("pista-2", "2026-11-23T09:15"), 400, "FRANJA_INVALIDA");
    error(await con("pista-9", "2026-11-21T16:30"), 404, "PISTA_NO_ENCONTRADA");
    assert.equal(await totalDe(api, "socio-041"), 0);
    // Sigue siendo su primera reserva: BIENVENIDA vale.
    const r = await con("pista-2", "2026-11-19T19:30");
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual(importes(r.cuerpo.reserva), { importeBase: 2800, descuento: 1400, importe: 1400, codigo: "BIENVENIDA" });
  }));

test("C8 · los intentos fallidos con CLUB10 no cuentan para su límite", () =>
  conApi(async (api) => {
    const [a, b] = await sociosLibres(api, 2);
    const club10 = (pistaId: string, inicio: string) => reservar(api, { socioId: a, pistaId, inicio, codigo: "CLUB10" });
    for (const inicio of ["2026-12-09T13:30", "2026-12-09T15:00"]) assert.equal((await club10("pista-1", inicio)).status, 201, inicio);
    // Tres intentos que fallan por las reglas del club.
    error(await club10("pista-4", "2026-12-10T13:30"), 409, "PISTA_CERRADA");
    assert.equal((await reservar(api, { socioId: b, pistaId: "pista-2", inicio: "2026-12-10T15:00" })).status, 201);
    error(await club10("pista-2", "2026-12-10T15:00"), 409, "FRANJA_NO_DISPONIBLE");
    error(await club10("pista-1", "2026-12-04T09:00"), 409, "FRANJA_PASADA");
    // Y uno que choca con el límite de 3 reservas futuras.
    const sinCodigo = await reservar(api, { socioId: a, pistaId: "pista-1", inicio: "2026-12-09T16:30" });
    assert.equal(sinCodigo.status, 201, sinCodigo.texto);
    error(await club10("pista-1", "2026-12-10T13:30"), 409, "LIMITE_DE_RESERVAS");
    // Con sitio otra vez, el socio solo lleva 2 reservas con CLUB10: la tercera vale.
    assert.equal((await api.pedir("POST", `/api/reservas/${sinCodigo.cuerpo.reserva.id}/cancelar`)).status, 200);
    const tercera = await club10("pista-1", "2026-12-10T13:30");
    assert.equal(tercera.status, 201, tercera.texto);
    assert.deepEqual(importes(tercera.cuerpo.reserva), { importeBase: 1800, descuento: 180, importe: 1620, codigo: "CLUB10" });
  }, DICIEMBRE));

test("C8 · las reglas del club se comprueban antes que las condiciones del código", async () => {
  // En cada intento falla una sola regla del club y, además, el código no valdría.
  await conApi(async (api) => {
    const estado = (await api.pedir("GET", "/_estado")).cuerpo;
    const inactivo = estado.socios.find((s: any) => s.cuotaActiva === false && estado.reservas.some((r: any) => r.socioId === s.id))?.id;
    assert.ok(inactivo, "hace falta un socio con la cuota inactiva y reservas");
    // Tiene reservas, así que BIENVENIDA no valdría, pero va primero la cuota.
    error(await reservar(api, { socioId: inactivo, pistaId: "pista-2", inicio: "2026-12-12T16:30", codigo: "BIENVENIDA" }), 409, "CUOTA_INACTIVA");
    // MANANAS no valdría en sábado ni a las 19:30, pero va primero lo que impide la reserva.
    const mananas = (pistaId: string, inicio: string) => reservar(api, { socioId: "socio-041", pistaId, inicio, codigo: "MANANAS" });
    error(await mananas("pista-4", "2026-12-12T09:00"), 409, "PISTA_CERRADA");
    error(await mananas("pista-1", "2026-12-05T09:00"), 409, "FRANJA_PASADA");
    error(await mananas("pista-2", "2026-12-12T09:15"), 400, "FRANJA_INVALIDA");
    const [a, b] = await sociosLibres(api, 2);
    assert.equal((await reservar(api, { socioId: b, pistaId: "pista-1", inicio: "2026-12-10T19:30" })).status, 201);
    error(await mananas("pista-1", "2026-12-10T19:30"), 409, "FRANJA_NO_DISPONIBLE");
    // Con 3 reservas futuras con CLUB10, la cuarta choca antes con el límite de reservas.
    for (const inicio of ["2026-12-09T13:30", "2026-12-09T15:00", "2026-12-09T16:30"]) {
      assert.equal((await reservar(api, { socioId: a, pistaId: "pista-1", inicio, codigo: "CLUB10" })).status, 201, inicio);
    }
    error(await reservar(api, { socioId: a, pistaId: "pista-1", inicio: "2026-12-10T13:30", codigo: "CLUB10" }), 409, "LIMITE_DE_RESERVAS");
  }, DICIEMBRE);
  await conApi(async (api) => {
    // En 2027 BIENVENIDA ya no vale, pero la franja ya ha empezado y eso va primero.
    error(await reservar(api, { socioId: "socio-041", pistaId: "pista-1", inicio: "2027-01-04T09:00", codigo: "BIENVENIDA" }), 409, "FRANJA_PASADA");
  }, "2027-01-04T12:00");
});
