// Tests ocultos de la spec codigos-descuento: sin código todo sigue igual (C1) y la disponibilidad no cambia (C10).
// Caja negra: solo la API HTTP, /_estado y /_reloj. Cada test arranca su propia API.
// Comparan con el comportamiento de la base: mismos campos, importes y errores que antes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

/** Arranca una API solo para este test y, si se pasa `ahora`, mueve antes el reloj del club. */
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

/** Los campos que ya tenía una reserva en la base. */
function camposDeAntes(reserva: any) {
  const { socioId, pistaId, inicio, fin, estado, importe, notas } = reserva ?? {};
  return { socioId, pistaId, inicio, fin, estado, importe, notas };
}

// Precios de la semilla: valle y punta por pista. Es punta a partir de las 18:00 y todo el fin de semana.
const PRECIOS: Record<string, { valle: number; punta: number }> = {
  "pista-1": { valle: 1800, punta: 2800 },
  "pista-2": { valle: 1800, punta: 2800 },
  "pista-3": { valle: 1200, punta: 2000 },
  "pista-4": { valle: 1400, punta: 2200 },
};
const HORAS = ["09:00", "10:30", "12:00", "13:30", "15:00", "16:30", "18:00", "19:30", "21:00"];

function precioDe(pistaId: string, inicio: string): number {
  const dia = new Date(`${inicio.slice(0, 10)}T12:00:00Z`).getUTCDay();
  const punta = dia === 0 || dia === 6 || inicio.slice(11) >= "18:00";
  return punta ? PRECIOS[pistaId]!.punta : PRECIOS[pistaId]!.valle;
}

/** Precio de cada franja del día, por pista, según GET /api/disponibilidad. */
async function preciosDelDia(api: Api, fecha: string): Promise<Record<string, Record<string, number>>> {
  const r = await api.pedir("GET", `/api/disponibilidad?fecha=${fecha}`);
  assert.equal(r.status, 200, r.texto);
  return Object.fromEntries(r.cuerpo.pistas.map((p: any) => [p.pistaId, Object.fromEntries(p.franjas.map((f: any) => [f.inicio, f.precio]))]));
}

function preciosEsperados(fecha: string): Record<string, Record<string, number>> {
  return Object.fromEntries(Object.keys(PRECIOS).map((pistaId) =>
    [pistaId, Object.fromEntries(HORAS.map((hora) => [`${fecha}T${hora}`, precioDe(pistaId, `${fecha}T${hora}`)]))]));
}

test("C1 · sin código, la reserva se crea como antes", () =>
  conApi(async (api) => {
    // Como en club/test/club.test.ts: socio-004 reserva la pista 2 el sábado 21 a las 16:30, por 28,00 €.
    const r = await reservar(api, { socioId: "socio-004", pistaId: "pista-2", inicio: "2026-11-21T16:30", notas: "Traen sus palas" });
    assert.equal(r.status, 201, r.texto);
    const esperado = {
      socioId: "socio-004", pistaId: "pista-2", inicio: "2026-11-21T16:30", fin: "2026-11-21T18:00",
      estado: "confirmada", importe: 2800, notas: "Traen sus palas",
    };
    assert.deepEqual(camposDeAntes(r.cuerpo.reserva), esperado);
    assert.equal("codigo" in r.cuerpo.reserva, false, "sin código, la reserva no lleva codigo");
    assert.equal(r.cuerpo.reserva.penalizacion, undefined);
    const leida = await api.pedir("GET", `/api/reservas/${r.cuerpo.reserva.id}`);
    assert.equal(leida.status, 200, leida.texto);
    assert.deepEqual(camposDeAntes(leida.cuerpo.reserva), esperado);
    assert.equal("codigo" in leida.cuerpo.reserva, false, "sin código, la reserva no lleva codigo");
    const dia = await api.pedir("GET", "/api/disponibilidad?fecha=2026-11-21&pista=pista-2");
    const franja = dia.cuerpo.pistas.find((p: any) => p.pistaId === "pista-2").franjas.find((f: any) => f.inicio === "2026-11-21T16:30");
    assert.equal(franja.estado, "reservada");
  }));

test("C1 · sin código no se descuenta nada, aunque el socio y la franja cumplan las condiciones de un código", () =>
  conApi(async (api) => {
    // socio-041 no tiene reservas (BIENVENIDA) y el lunes 7 de diciembre a las 09:00 es mañana entre semana (MANANAS).
    const r = await reservar(api, { socioId: "socio-041", pistaId: "pista-1", inicio: "2026-12-07T09:00" });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.cuerpo.reserva.importe, 1800);
    assert.equal("codigo" in r.cuerpo.reserva, false, "sin código, la reserva no lleva codigo");
  }, "2026-12-07T08:00"));

test("C1 · sin código, importeBase es igual a importe y descuento es 0", () =>
  conApi(async (api) => {
    const a = await reservar(api, { socioId: "socio-004", pistaId: "pista-2", inicio: "2026-11-21T16:30" });
    assert.equal(a.status, 201, a.texto);
    const b = await reservar(api, { socioId: "socio-003", pistaId: "pista-3", inicio: "2026-11-24T12:00" });
    assert.equal(b.status, 201, b.texto);
    const esperadoA = { importeBase: 2800, descuento: 0, importe: 2800, codigo: undefined };
    const esperadoB = { importeBase: 1200, descuento: 0, importe: 1200, codigo: undefined };
    assert.deepEqual(importes(a.cuerpo.reserva), esperadoA);
    assert.deepEqual(importes(b.cuerpo.reserva), esperadoB);
    assert.deepEqual(importes((await api.pedir("GET", `/api/reservas/${a.cuerpo.reserva.id}`)).cuerpo.reserva), esperadoA);
    assert.deepEqual(importes((await api.pedir("GET", `/api/reservas/${b.cuerpo.reserva.id}`)).cuerpo.reserva), esperadoB);
    const lista = await api.pedir("GET", "/api/reservas?socio=socio-004&fecha=2026-11-21");
    assert.deepEqual(importes(lista.cuerpo.reservas.find((r: any) => r.id === a.cuerpo.reserva.id)), esperadoA);
  }));

test("C1 · sin código, las reglas del club responden como antes", () =>
  conApi(async (api) => {
    // Un socio con la cuota inactiva y sin reservas futuras, para que solo falle la cuota.
    const estado = (await api.pedir("GET", "/_estado")).cuerpo;
    const futuras = (id: string) => estado.reservas.some((r: any) => r.socioId === id && r.estado === "confirmada" && r.inicio > estado.ahora);
    const inactivo = estado.socios.find((s: any) => s.cuotaActiva === false && !futuras(s.id))?.id;
    assert.ok(inactivo, "hace falta un socio con la cuota inactiva");
    error(await reservar(api, { socioId: inactivo, pistaId: "pista-2", inicio: "2026-11-21T16:30" }), 409, "CUOTA_INACTIVA");
    error(await reservar(api, { socioId: "socio-003", pistaId: "pista-4", inicio: "2026-11-21T16:30" }), 409, "PISTA_CERRADA");
    error(await reservar(api, { socioId: "socio-003", pistaId: "pista-2", inicio: "2026-11-18T09:00" }), 409, "FRANJA_PASADA");
    error(await reservar(api, { socioId: "socio-003", pistaId: "pista-1", inicio: "2026-11-19T19:30" }), 409, "FRANJA_NO_DISPONIBLE");
    error(await reservar(api, { socioId: "socio-003", pistaId: "pista-2", inicio: "2026-11-23T09:15" }), 400, "FRANJA_INVALIDA");
    error(await reservar(api, { socioId: "socio-999", pistaId: "pista-2", inicio: "2026-11-21T16:30" }), 404, "SOCIO_NO_ENCONTRADO");
    error(await reservar(api, { socioId: "socio-003", pistaId: "pista-9", inicio: "2026-11-21T16:30" }), 404, "PISTA_NO_ENCONTRADA");
    error(await reservar(api, { socioId: "socio-003", inicio: "2026-11-21T16:30" }), 400, "DATOS_INVALIDOS");
    // socio-041 llena sus 3 reservas futuras y la cuarta choca con el límite.
    for (const [pistaId, inicio] of [["pista-2", "2026-11-19T19:30"], ["pista-3", "2026-11-19T19:30"], ["pista-2", "2026-11-23T19:30"]]) {
      const r = await reservar(api, { socioId: "socio-041", pistaId, inicio });
      assert.equal(r.status, 201, r.texto);
    }
    error(await reservar(api, { socioId: "socio-041", pistaId: "pista-3", inicio: "2026-11-24T12:00" }), 409, "LIMITE_DE_RESERVAS");
  }));

test("C10 · la disponibilidad muestra el precio de cada franja sin descuento", () =>
  conApi(async (api) => {
    // Un jueves con reservas, un lunes y un sábado sin reservas.
    for (const fecha of ["2026-11-19", "2026-12-07", "2026-12-12"]) {
      assert.deepEqual(await preciosDelDia(api, fecha), preciosEsperados(fecha), fecha);
    }
  }));

test("C10 · después de reservar con código, la disponibilidad sigue mostrando el precio sin descuento", () =>
  conApi(async (api) => {
    const estado = (await api.pedir("GET", "/_estado")).cuerpo;
    const socio = estado.socios.find((s: any) => s.cuotaActiva === true && s.id !== "socio-040" && s.id !== "socio-041")?.id;
    assert.ok(socio, "hace falta un socio con la cuota al día");
    const conCodigo = [
      { socioId: "socio-041", pistaId: "pista-1", inicio: "2026-12-08T13:30", codigo: "BIENVENIDA" },
      { socioId: socio, pistaId: "pista-3", inicio: "2026-12-08T09:00", codigo: "MANANAS" },
      { socioId: socio, pistaId: "pista-2", inicio: "2026-12-12T18:00", codigo: "CLUB10" },
    ];
    for (const cuerpo of conCodigo) await reservar(api, cuerpo);
    for (const fecha of ["2026-12-08", "2026-12-12"]) {
      assert.deepEqual(await preciosDelDia(api, fecha), preciosEsperados(fecha), fecha);
    }
  }, "2026-12-07T08:00"));
