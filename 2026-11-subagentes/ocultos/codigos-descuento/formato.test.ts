// Tests ocultos de la spec codigos-descuento: el formato del código (C5) y un solo código por reserva (C6).
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

// Lunes 7 de diciembre de 2026, antes de la primera franja.
const DICIEMBRE = "2026-12-07T08:00";

test("C5 · no importan las mayúsculas ni los espacios de alrededor", () =>
  conApi(async (api) => {
    const [a, b, c] = await sociosLibres(api, 3);
    const r = await reservar(api, { socioId: a, pistaId: "pista-1", inicio: "2026-12-12T18:00", codigo: "  club10 " });
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual(importes(r.cuerpo.reserva), { importeBase: 2800, descuento: 280, importe: 2520, codigo: "CLUB10" });
    const leida = await api.pedir("GET", `/api/reservas/${r.cuerpo.reserva.id}`);
    assert.equal(leida.cuerpo.reserva.codigo, "CLUB10", "el código se guarda en mayúsculas");
    const mixto = await reservar(api, { socioId: b, pistaId: "pista-2", inicio: "2026-12-12T18:00", codigo: "Club10" });
    assert.equal(mixto.status, 201, mixto.texto);
    assert.deepEqual(importes(mixto.cuerpo.reserva), { importeBase: 2800, descuento: 280, importe: 2520, codigo: "CLUB10" });
    const manana = await reservar(api, { socioId: c, pistaId: "pista-1", inicio: "2026-12-07T09:00", codigo: " mananas  " });
    assert.equal(manana.status, 201, manana.texto);
    assert.deepEqual(importes(manana.cuerpo.reserva), { importeBase: 1800, descuento: 400, importe: 1400, codigo: "MANANAS" });
  }, DICIEMBRE));

test("C5 · un código que no está en el catálogo responde 400 CODIGO_INVALIDO", () =>
  conApi(async (api) => {
    const [a] = await sociosLibres(api, 1);
    const antes = await totalDe(api, a!);
    for (const codigo of ["VERANO", "CLUB20", "CLUB 10", "BIENVENIDA2026"]) {
      error(await reservar(api, { socioId: a, pistaId: "pista-1", inicio: "2026-12-12T18:00", codigo }), 400, "CODIGO_INVALIDO", codigo);
    }
    assert.equal(await totalDe(api, a!), antes, "con el código rechazado no se crea la reserva");
  }, DICIEMBRE));

test("C5 · si codigo no es un texto responde 400 DATOS_INVALIDOS", () =>
  conApi(async (api) => {
    const [a] = await sociosLibres(api, 1);
    const antes = await totalDe(api, a!);
    for (const codigo of [10, 0, true, false, {}, ["CLUB10"]]) {
      const r = await reservar(api, { socioId: a, pistaId: "pista-1", inicio: "2026-12-12T18:00", codigo });
      error(r, 400, "DATOS_INVALIDOS", JSON.stringify(codigo));
    }
    assert.equal(await totalDe(api, a!), antes, "con el código rechazado no se crea la reserva");
  }, DICIEMBRE));

test("C6 · con BIENVENIDA en una mañana entre semana solo se descuenta el 50 %", () =>
  conApi(async (api) => {
    // Primera reserva de socio-041 (BIENVENIDA) en una mañana de lunes (MANANAS): solo cuenta el código que manda.
    const r = await reservar(api, { socioId: "socio-041", pistaId: "pista-1", inicio: "2026-12-07T09:00", codigo: "BIENVENIDA" });
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual(importes(r.cuerpo.reserva), { importeBase: 1800, descuento: 900, importe: 900, codigo: "BIENVENIDA" });
  }, DICIEMBRE));

test("C6 · con MANANAS o CLUB10 solo se descuenta lo de ese código", () =>
  conApi(async (api) => {
    const [a] = await sociosLibres(api, 1);
    // socio-041 podría usar BIENVENIDA, pero manda MANANAS.
    const m = await reservar(api, { socioId: "socio-041", pistaId: "pista-1", inicio: "2026-12-07T09:00", codigo: "MANANAS" });
    assert.equal(m.status, 201, m.texto);
    assert.deepEqual(importes(m.cuerpo.reserva), { importeBase: 1800, descuento: 400, importe: 1400, codigo: "MANANAS" });
    // Una mañana de lunes con CLUB10: no se suma MANANAS.
    const c = await reservar(api, { socioId: a, pistaId: "pista-3", inicio: "2026-12-07T10:30", codigo: "CLUB10" });
    assert.equal(c.status, 201, c.texto);
    assert.deepEqual(importes(c.cuerpo.reserva), { importeBase: 1200, descuento: 120, importe: 1080, codigo: "CLUB10" });
  }, DICIEMBRE));

test("C6 · no se acepta más de un código en la misma reserva", () =>
  conApi(async (api) => {
    const [a] = await sociosLibres(api, 1);
    const antes = await totalDe(api, a!);
    const lista = await reservar(api, { socioId: a, pistaId: "pista-1", inicio: "2026-12-07T09:00", codigo: ["CLUB10", "MANANAS"] });
    error(lista, 400, "DATOS_INVALIDOS", "lista de códigos");
    // Dos códigos en un mismo texto no son un código del catálogo. La spec no fija el código de error: basta con un 400.
    for (const codigo of ["CLUB10 MANANAS", "CLUB10,MANANAS"]) {
      const r = await reservar(api, { socioId: a, pistaId: "pista-1", inicio: "2026-12-07T09:00", codigo });
      assert.equal(r.status, 400, `${codigo} ${r.texto}`);
    }
    assert.equal(await totalDe(api, a!), antes, "con los códigos rechazados no se crea la reserva");
    const nora = await reservar(api, { socioId: "socio-041", pistaId: "pista-1", inicio: "2026-12-07T09:00", codigo: "BIENVENIDA MANANAS" });
    assert.equal(nora.status, 400, nora.texto);
    assert.equal(await totalDe(api, "socio-041"), 0, "con los códigos rechazados no se crea la reserva");
  }, DICIEMBRE));
