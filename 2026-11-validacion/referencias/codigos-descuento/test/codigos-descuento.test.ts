// Códigos de descuento al reservar (docs/specs/codigos-descuento.md), probados a través de la API.
// Cada test arranca su propia API. Los de diciembre parten de un club sin reservas futuras: la semilla acaba el 24 de noviembre.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

async function conApi(prueba: (api: Api) => Promise<void>, ahora?: string) {
  const api = await arrancarApi(ahora ? { AHORA: ahora } : {});
  try {
    await prueba(api);
  } finally {
    api.cerrar();
  }
}

const reservar = (api: Api, cuerpo: Record<string, unknown>) => api.pedir("POST", "/api/reservas", { cuerpo });
const mover = (api: Api, ahora: string) => api.pedir("POST", "/_reloj", { cuerpo: { ahora } });
const cancelar = (api: Api, id: string, cuerpo?: Record<string, unknown>) => api.pedir("POST", `/api/reservas/${id}/cancelar`, { cuerpo });
const importes = (r: { importeBase: number; descuento: number; importe: number; codigo?: string }) =>
  ({ importeBase: r.importeBase, descuento: r.descuento, importe: r.importe, codigo: r.codigo });

// Lunes 7 de diciembre de 2026, antes de la primera franja.
const DICIEMBRE = "2026-12-07T08:00";

test("sin código, la reserva se crea como antes, con importeBase igual a importe, descuento 0 y sin codigo", () =>
  conApi(async (api) => {
    const r = await reservar(api, { socioId: "socio-004", pistaId: "pista-2", inicio: "2026-11-21T16:30" });
    assert.equal(r.status, 201);
    assert.deepEqual(importes(r.cuerpo.reserva), { importeBase: 2800, descuento: 0, importe: 2800, codigo: undefined });
    assert.equal("codigo" in r.cuerpo.reserva, false);
    // Aunque el socio pudiera usar BIENVENIDA y la franja MANANAS, sin código no se descuenta nada.
    const nora = await reservar(api, { socioId: "socio-041", pistaId: "pista-3", inicio: "2026-11-23T09:00" });
    assert.equal(nora.status, 201);
    assert.deepEqual(importes(nora.cuerpo.reserva), { importeBase: 1200, descuento: 0, importe: 1200, codigo: undefined });
  }));

test("BIENVENIDA descuenta el 50 % en la primera reserva del socio y solo en ella", () =>
  conApi(async (api) => {
    const primera = await reservar(api, { socioId: "socio-041", pistaId: "pista-2", inicio: "2026-11-19T19:30", codigo: "BIENVENIDA" });
    assert.equal(primera.status, 201);
    assert.deepEqual(importes(primera.cuerpo.reserva), { importeBase: 2800, descuento: 1400, importe: 1400, codigo: "BIENVENIDA" });
    const segunda = await reservar(api, { socioId: "socio-041", pistaId: "pista-3", inicio: "2026-11-19T19:30", codigo: "BIENVENIDA" });
    assert.equal(segunda.status, 409);
    assert.equal(segunda.cuerpo.error.codigo, "CODIGO_NO_APLICABLE");
    // socio-003 tiene reservas en la semilla, aunque ya hayan pasado.
    const veterano = await reservar(api, { socioId: "socio-003", pistaId: "pista-3", inicio: "2026-11-24T12:00", codigo: "BIENVENIDA" });
    assert.equal(veterano.cuerpo.error.codigo, "CODIGO_NO_APLICABLE");
  }));

test("BIENVENIDA no vale si el socio ya tiene una reserva, aunque esté cancelada", () =>
  conApi(async (api) => {
    const sinCodigo = await reservar(api, { socioId: "socio-041", pistaId: "pista-1", inicio: "2026-12-09T13:30" });
    assert.equal((await cancelar(api, sinCodigo.cuerpo.reserva.id)).cuerpo.reserva.estado, "cancelada");
    const r = await reservar(api, { socioId: "socio-041", pistaId: "pista-1", inicio: "2026-12-10T13:30", codigo: "BIENVENIDA" });
    assert.equal(r.status, 409);
    assert.equal(r.cuerpo.error.codigo, "CODIGO_NO_APLICABLE");
  }, DICIEMBRE));

test("BIENVENIDA vale en reservas hechas hasta el 31 de diciembre de 2026 incluido, según la hora del club", async () => {
  await conApi(async (api) => {
    const r = await reservar(api, { socioId: "socio-041", pistaId: "pista-1", inicio: "2027-01-04T13:30", codigo: "BIENVENIDA" });
    assert.equal(r.status, 201);
    assert.equal(r.cuerpo.reserva.descuento, 900);
  }, "2026-12-31T23:59");
  await conApi(async (api) => {
    const r = await reservar(api, { socioId: "socio-041", pistaId: "pista-1", inicio: "2027-01-04T13:30", codigo: "BIENVENIDA" });
    assert.equal(r.status, 409);
    assert.equal(r.cuerpo.error.codigo, "CODIGO_NO_APLICABLE");
  }, "2027-01-01T00:00");
});

test("MANANAS descuenta 4,00 € de lunes a viernes antes de las 12:00 y no vale en otras franjas", () =>
  conApi(async (api) => {
    const lunes = await reservar(api, { socioId: "socio-003", pistaId: "pista-1", inicio: "2026-12-07T09:00", codigo: "MANANAS" });
    assert.deepEqual(importes(lunes.cuerpo.reserva), { importeBase: 1800, descuento: 400, importe: 1400, codigo: "MANANAS" });
    const viernes = await reservar(api, { socioId: "socio-003", pistaId: "pista-3", inicio: "2026-12-11T10:30", codigo: "MANANAS" });
    assert.deepEqual(importes(viernes.cuerpo.reserva), { importeBase: 1200, descuento: 400, importe: 800, codigo: "MANANAS" });
    for (const inicio of ["2026-12-07T12:00", "2026-12-08T18:00", "2026-12-12T09:00", "2026-12-13T10:30"]) {
      const r = await reservar(api, { socioId: "socio-004", pistaId: "pista-1", inicio, codigo: "MANANAS" });
      assert.equal(r.status, 409, inicio);
      assert.equal(r.cuerpo.error.codigo, "CODIGO_NO_APLICABLE", inicio);
    }
  }, DICIEMBRE));

test("CLUB10 descuenta el 10 % y cada socio puede tener como mucho 3 reservas con él", () =>
  conApi(async (api) => {
    for (const inicio of ["2026-12-07T13:30", "2026-12-07T15:00", "2026-12-07T16:30"]) {
      const r = await reservar(api, { socioId: "socio-003", pistaId: "pista-1", inicio, codigo: "CLUB10" });
      assert.deepEqual(importes(r.cuerpo.reserva), { importeBase: 1800, descuento: 180, importe: 1620, codigo: "CLUB10" });
    }
    // Ya han pasado, pero siguen confirmadas: cuentan.
    await mover(api, "2026-12-07T20:00");
    const cuarta = await reservar(api, { socioId: "socio-003", pistaId: "pista-1", inicio: "2026-12-12T18:00", codigo: "CLUB10" });
    assert.equal(cuarta.status, 409);
    assert.equal(cuarta.cuerpo.error.codigo, "CODIGO_NO_APLICABLE");
    // El límite es de cada socio.
    const otro = await reservar(api, { socioId: "socio-004", pistaId: "pista-1", inicio: "2026-12-12T18:00", codigo: "CLUB10" });
    assert.deepEqual(importes(otro.cuerpo.reserva), { importeBase: 2800, descuento: 280, importe: 2520, codigo: "CLUB10" });
  }, DICIEMBRE));

test("las reservas canceladas no cuentan para el límite de CLUB10", () =>
  conApi(async (api) => {
    const ids: string[] = [];
    for (const inicio of ["2026-12-09T13:30", "2026-12-09T15:00", "2026-12-09T16:30"]) {
      ids.push((await reservar(api, { socioId: "socio-003", pistaId: "pista-1", inicio, codigo: "CLUB10" })).cuerpo.reserva.id);
    }
    await cancelar(api, ids[0]!);
    const r = await reservar(api, { socioId: "socio-003", pistaId: "pista-1", inicio: "2026-12-10T13:30", codigo: "CLUB10" });
    assert.equal(r.status, 201);
    assert.equal(r.cuerpo.reserva.descuento, 180);
  }, DICIEMBRE));

test("el código vale en mayúsculas o minúsculas y con espacios alrededor, y se guarda en mayúsculas", () =>
  conApi(async (api) => {
    const r = await reservar(api, { socioId: "socio-003", pistaId: "pista-1", inicio: "2026-12-12T18:00", codigo: "  club10 " });
    assert.equal(r.status, 201);
    assert.equal(r.cuerpo.reserva.codigo, "CLUB10");
    assert.equal(r.cuerpo.reserva.descuento, 280);
    const m = await reservar(api, { socioId: "socio-004", pistaId: "pista-1", inicio: "2026-12-07T09:00", codigo: "Mananas" });
    assert.equal(m.cuerpo.reserva.codigo, "MANANAS");
  }, DICIEMBRE));

test("un código que no está en el catálogo responde 400 CODIGO_INVALIDO y uno que no es texto, 400 DATOS_INVALIDOS", () =>
  conApi(async (api) => {
    for (const codigo of ["VERANO", "CLUB 10", "CLUB10 MANANAS"]) {
      const r = await reservar(api, { socioId: "socio-041", pistaId: "pista-1", inicio: "2026-12-12T18:00", codigo });
      assert.equal(r.status, 400, codigo);
      assert.equal(r.cuerpo.error.codigo, "CODIGO_INVALIDO", codigo);
    }
    for (const codigo of [10, 0, true, {}, ["CLUB10", "MANANAS"]]) {
      const r = await reservar(api, { socioId: "socio-041", pistaId: "pista-1", inicio: "2026-12-12T18:00", codigo });
      assert.equal(r.status, 400, JSON.stringify(codigo));
      assert.equal(r.cuerpo.error.codigo, "DATOS_INVALIDOS", JSON.stringify(codigo));
    }
    const nora = await api.pedir("GET", "/api/reservas?socio=socio-041");
    assert.equal(nora.cuerpo.total, 0);
  }, DICIEMBRE));

test("los descuentos no se acumulan: solo cuenta el código de la reserva", () =>
  conApi(async (api) => {
    // Primera reserva de socio-041 y mañana de lunes: solo se aplica el código que manda.
    const r = await reservar(api, { socioId: "socio-041", pistaId: "pista-1", inicio: "2026-12-07T09:00", codigo: "BIENVENIDA" });
    assert.deepEqual(importes(r.cuerpo.reserva), { importeBase: 1800, descuento: 900, importe: 900, codigo: "BIENVENIDA" });
    const c = await reservar(api, { socioId: "socio-003", pistaId: "pista-3", inicio: "2026-12-07T10:30", codigo: "CLUB10" });
    assert.deepEqual(importes(c.cuerpo.reserva), { importeBase: 1200, descuento: 120, importe: 1080, codigo: "CLUB10" });
  }, DICIEMBRE));

test("GET /api/reservas/:id y GET /api/reservas devuelven los importes y el código guardados", () =>
  conApi(async (api) => {
    const creada = (await reservar(api, { socioId: "socio-003", pistaId: "pista-1", inicio: "2026-12-12T18:00", codigo: "CLUB10" })).cuerpo.reserva;
    const esperado = { importeBase: 2800, descuento: 280, importe: 2520, codigo: "CLUB10" };
    assert.deepEqual(importes((await api.pedir("GET", `/api/reservas/${creada.id}`)).cuerpo.reserva), esperado);
    const lista = await api.pedir("GET", "/api/reservas?socio=socio-003&fecha=2026-12-12");
    assert.deepEqual(lista.cuerpo.reservas.map(importes), [esperado]);
  }, DICIEMBRE));

test("las reglas del club van primero y el código no cuenta como usado", () =>
  conApi(async (api) => {
    const cerrada = await reservar(api, { socioId: "socio-041", pistaId: "pista-4", inicio: "2026-11-21T16:30", codigo: "BIENVENIDA" });
    assert.equal(cerrada.cuerpo.error.codigo, "PISTA_CERRADA");
    const cuota = await reservar(api, { socioId: "socio-011", pistaId: "pista-2", inicio: "2026-11-21T16:30", codigo: "BIENVENIDA" });
    assert.equal(cuota.cuerpo.error.codigo, "CUOTA_INACTIVA");
    // Jueves a las 19:30: MANANAS no valdría, pero la franja está ocupada y eso va primero.
    const ocupada = await reservar(api, { socioId: "socio-041", pistaId: "pista-1", inicio: "2026-11-19T19:30", codigo: "MANANAS" });
    assert.equal(ocupada.cuerpo.error.codigo, "FRANJA_NO_DISPONIBLE");
    const bienvenida = await reservar(api, { socioId: "socio-041", pistaId: "pista-2", inicio: "2026-11-21T16:30", codigo: "BIENVENIDA" });
    assert.equal(bienvenida.status, 201);
    assert.equal(bienvenida.cuerpo.reserva.descuento, 1400);
  }));

test("con 3 reservas futuras, un cuarto CLUB10 responde LIMITE_DE_RESERVAS y no gasta el código", () =>
  conApi(async (api) => {
    for (const inicio of ["2026-12-09T13:30", "2026-12-09T15:00"]) {
      await reservar(api, { socioId: "socio-003", pistaId: "pista-1", inicio, codigo: "CLUB10" });
    }
    const sinCodigo = (await reservar(api, { socioId: "socio-003", pistaId: "pista-1", inicio: "2026-12-09T16:30" })).cuerpo.reserva;
    const limite = await reservar(api, { socioId: "socio-003", pistaId: "pista-1", inicio: "2026-12-10T13:30", codigo: "CLUB10" });
    assert.equal(limite.status, 409);
    assert.equal(limite.cuerpo.error.codigo, "LIMITE_DE_RESERVAS");
    await cancelar(api, sinCodigo.id);
    const tercera = await reservar(api, { socioId: "socio-003", pistaId: "pista-1", inicio: "2026-12-10T13:30", codigo: "CLUB10" });
    assert.equal(tercera.status, 201);
    assert.equal(tercera.cuerpo.reserva.descuento, 180);
  }, DICIEMBRE));

test("la penalización por cancelar fuera de plazo es el importe con descuento", () =>
  conApi(async (api) => {
    const r = (await reservar(api, { socioId: "socio-003", pistaId: "pista-1", inicio: "2026-12-08T18:00", codigo: "CLUB10" })).cuerpo.reserva;
    await mover(api, "2026-12-08T10:00");
    assert.equal((await cancelar(api, r.id)).cuerpo.error.codigo, "FUERA_DE_PLAZO");
    const forzada = await cancelar(api, r.id, { forzar: true });
    assert.equal(forzada.cuerpo.reserva.penalizacion, 2520);
  }, DICIEMBRE));

test("la disponibilidad sigue mostrando el precio sin descuento", () =>
  conApi(async (api) => {
    await reservar(api, { socioId: "socio-003", pistaId: "pista-1", inicio: "2026-12-07T09:00", codigo: "MANANAS" });
    const dia = await api.pedir("GET", "/api/disponibilidad?fecha=2026-12-07&pista=pista-1");
    const franja = dia.cuerpo.pistas[0].franjas.find((f: { inicio: string }) => f.inicio === "2026-12-07T09:00");
    assert.equal(franja.estado, "reservada");
    assert.equal(franja.precio, 1800);
  }, DICIEMBRE));

test("el README documenta el campo codigo, el catálogo, los campos nuevos y los errores nuevos", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  for (const texto of ["codigo?", "BIENVENIDA", "MANANAS", "CLUB10", "importeBase", "descuento", "CODIGO_INVALIDO", "CODIGO_NO_APLICABLE"]) {
    assert.ok(readme.includes(texto), `el README no menciona ${texto}`);
  }
});
