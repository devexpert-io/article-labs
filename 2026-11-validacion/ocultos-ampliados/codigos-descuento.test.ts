// Tests ampliados de la spec codigos-descuento: un test por clase de defecto de comportamiento confirmado en la revisión
// a mano de los hallazgos de los validadores. Mismos principios que los tests ocultos: caja negra por la API HTTP,
// /_estado y /_reloj, cada test arranca su propia API y el reloj del club va fijado (AHORA y TZ).
//
// X1 · un código fuera del catálogo no tapa el error de las reglas del club (C8). Visto en codigos-descuento-haiku-r1.
// X2 · un código vacío o de solo espacios no se toma por una reserva sin código (C5). Visto en luna-r1 y luna-r2.
// X3 · lo demás no cambia: los socios y las reservas de la semilla son los de la base (C1). Visto en luna-r1 (B, 2.ª reparación).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

/** Arranca una API solo para este test, con el reloj del club en `ahora` y la zona horaria fija. */
async function conApi(prueba: (api: Api) => Promise<void>, ahora = "2026-11-18T10:00"): Promise<void> {
  const api = await arrancarApi({ AHORA: ahora, TZ: "UTC" });
  try {
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

/** Cuántas reservas tiene el socio, en cualquier estado. */
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

test("X1 · con un código que no está en el catálogo, si la reserva no se puede hacer se responde el error de las reglas del club (C8)", () =>
  conApi(async (api) => {
    // De la semilla solo se usa lo estable, como en los tests ocultos: pista 4 cerrada, pista 1 ocupada el jueves 19
    // a las 19:30, pistas 2 y 3 libres a esa hora, socio-041 sin reservas y algún socio con la cuota inactiva.
    const codigo = "VERANO";
    const estado = (await api.pedir("GET", "/_estado")).cuerpo;
    const futuras = (id: string) => estado.reservas.some((r: any) => r.socioId === id && r.estado === "confirmada" && r.inicio > estado.ahora);
    const inactivo = estado.socios.find((s: any) => s.cuotaActiva === false && !futuras(s.id))?.id;
    assert.ok(inactivo, "hace falta un socio con la cuota inactiva");
    error(await reservar(api, { socioId: inactivo, pistaId: "pista-2", inicio: "2026-11-21T16:30", codigo }), 409, "CUOTA_INACTIVA");
    error(await reservar(api, { socioId: "socio-003", pistaId: "pista-4", inicio: "2026-11-21T16:30", codigo }), 409, "PISTA_CERRADA");
    error(await reservar(api, { socioId: "socio-003", pistaId: "pista-2", inicio: "2026-11-18T09:00", codigo }), 409, "FRANJA_PASADA");
    error(await reservar(api, { socioId: "socio-003", pistaId: "pista-1", inicio: "2026-11-19T19:30", codigo }), 409, "FRANJA_NO_DISPONIBLE");
    error(await reservar(api, { socioId: "socio-003", pistaId: "pista-2", inicio: "2026-11-23T09:15", codigo }), 400, "FRANJA_INVALIDA");
    error(await reservar(api, { socioId: "socio-003", pistaId: "pista-9", inicio: "2026-11-21T16:30", codigo }), 404, "PISTA_NO_ENCONTRADA");
    error(await reservar(api, { socioId: "socio-999", pistaId: "pista-2", inicio: "2026-11-21T16:30", codigo }), 404, "SOCIO_NO_ENCONTRADO");
    // socio-041 llena sus 3 reservas futuras y la cuarta, con el código fuera del catálogo, choca con el límite.
    for (const [pistaId, inicio] of [["pista-2", "2026-11-19T19:30"], ["pista-3", "2026-11-19T19:30"], ["pista-2", "2026-11-23T19:30"]]) {
      const r = await reservar(api, { socioId: "socio-041", pistaId, inicio });
      assert.equal(r.status, 201, r.texto);
    }
    error(await reservar(api, { socioId: "socio-041", pistaId: "pista-3", inicio: "2026-11-24T12:00", codigo }), 409, "LIMITE_DE_RESERVAS");
    // Cuando la reserva sí se puede hacer, el código fuera del catálogo responde su propio error.
    error(await reservar(api, { socioId: "socio-003", pistaId: "pista-3", inicio: "2026-11-24T12:00", codigo }), 400, "CODIGO_INVALIDO");
  }));

test("X2 · un código vacío o de solo espacios responde 400 CODIGO_INVALIDO y no crea la reserva (C5)", () =>
  conApi(async (api) => {
    // Lunes 7 de diciembre antes de la primera franja: todas las franjas libres y nadie con reservas futuras.
    const [a] = await sociosLibres(api, 1);
    const antes = await totalDe(api, a!);
    const intentos: [string, string][] = [["", "2026-12-09T13:30"], ["   ", "2026-12-09T15:00"]];
    for (const [codigo, inicio] of intentos) {
      error(await reservar(api, { socioId: a, pistaId: "pista-1", inicio, codigo }), 400, "CODIGO_INVALIDO", JSON.stringify(codigo));
    }
    assert.equal(await totalDe(api, a!), antes, "con el código rechazado no se crea la reserva");
    // Sin el campo codigo, la misma reserva sí se puede hacer.
    const sinCodigo = await reservar(api, { socioId: a, pistaId: "pista-1", inicio: "2026-12-09T13:30" });
    assert.equal(sinCodigo.status, 201, sinCodigo.texto);
  }, "2026-12-07T08:00"));

// Huella de la semilla de la base (club/src/semilla.ts), con los campos que ya tenían los socios y las reservas.
// Calculada con esta misma función sobre la base y sobre la referencia, que dan lo mismo.
const SOCIOS_BASE = 41;
const HUELLA_SOCIOS_BASE = "d4e4b4e0b590059f563b596e19b8ea93427f5a7e6e0afe132ff5f5c6e21c769f";
const RESERVAS_BASE = 525;
const HUELLA_RESERVAS_BASE = "30ecb424fa629618a8d2677a1f713e2ada472f4e9402ab738fee8aa093878fae";

const huella = (datos: unknown) => createHash("sha256").update(JSON.stringify(datos)).digest("hex");
const porId = (a: any[], b: any[]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
const ids = (prefijo: string, cuantos: number, ancho: number) =>
  Array.from({ length: cuantos }, (_, i) => `${prefijo}${String(i + 1).padStart(ancho, "0")}`);

test("X3 · los socios y las reservas de la semilla siguen siendo los de la base (C1)", () =>
  conApi(async (api) => {
    const estado = (await api.pedir("GET", "/_estado")).cuerpo;
    // Socios: los mismos 41 de la base, con los mismos datos.
    const idsSocios: string[] = estado.socios.map((s: any) => s.id);
    const esperados = ids("socio-", SOCIOS_BASE, 3);
    assert.deepEqual(
      { sobran: idsSocios.filter((id) => !esperados.includes(id)), faltan: esperados.filter((id) => !idsSocios.includes(id)) },
      { sobran: [], faltan: [] },
      "los socios de la semilla no son los de la base",
    );
    const socios = estado.socios.map((s: any) => [s.id, s.nombre, s.email, s.cuotaActiva, s.rol]).sort(porId);
    assert.equal(huella(socios), HUELLA_SOCIOS_BASE, "los datos de los socios de la semilla no son los de la base");
    // Reservas: las mismas 525 de la base, con los mismos campos de antes (los importes nuevos se miran aparte).
    const idsReservas: string[] = estado.reservas.map((r: any) => r.id);
    const esperadas = ids("R-", RESERVAS_BASE, 4);
    assert.deepEqual(
      { sobran: idsReservas.filter((id) => !esperadas.includes(id)), faltan: esperadas.filter((id) => !idsReservas.includes(id)) },
      { sobran: [], faltan: [] },
      "las reservas de la semilla no son las de la base",
    );
    const reservas = estado.reservas
      .map((r: any) => [r.id, r.socioId, r.pistaId, r.inicio, r.fin, r.estado, r.importe, r.notas, r.penalizacion ?? null, r.motivoCancelacion ?? null])
      .sort(porId);
    assert.equal(huella(reservas), HUELLA_RESERVAS_BASE, "los datos de las reservas de la semilla no son los de la base");
    // No se aplican descuentos a las reservas que ya existen: sin código y, si guardan los importes nuevos, sin descuento.
    for (const r of estado.reservas) {
      assert.equal(r.codigo, undefined, `${r.id} lleva codigo`);
      if (r.descuento !== undefined) assert.equal(r.descuento, 0, `${r.id} lleva descuento`);
      if (r.importeBase !== undefined) assert.equal(r.importeBase, r.importe, `${r.id}: importeBase distinto de importe`);
    }
  }));
