// Facturas mensuales (docs/specs/facturas.md), probadas a través de la API.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

const GESTOR = "socio-040";

interface Reserva {
  id: string;
  socioId: string;
  inicio: string;
  estado: string;
  importe: number;
  penalizacion?: number;
}

/** Arranca una API con la hora del club en `ahora` y la cierra al terminar la prueba. */
async function conApi(ahora: string, prueba: (api: Api) => Promise<void>, entorno: Record<string, string> = {}) {
  const api = await arrancarApi({ AHORA: ahora, ...entorno });
  try {
    await prueba(api);
  } finally {
    api.cerrar();
  }
}

async function moverReloj(api: Api, ahora: string) {
  assert.equal((await api.pedir("POST", "/_reloj", { cuerpo: { ahora } })).status, 200);
}

async function reservar(api: Api, socioId: string, pistaId: string, inicio: string): Promise<Reserva> {
  const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio } });
  assert.equal(r.status, 201, `reservar ${pistaId} el ${inicio}: ${r.texto}`);
  return r.cuerpo.reserva;
}

async function cancelar(api: Api, id: string, cuerpo: Record<string, unknown> = {}) {
  assert.equal((await api.pedir("POST", `/api/reservas/${id}/cancelar`, { cuerpo })).status, 200);
}

/** Genera las facturas de un mes como `socio` (sin X-Socio si no se da). */
function generarComo(api: Api, socio: string | undefined, mes: unknown) {
  return api.pedir("POST", "/api/facturas", { cuerpo: { mes }, socio });
}

function generar(api: Api, mes: unknown) {
  return generarComo(api, GESTOR, mes);
}

function esError(r: Respuesta, http: number, codigo: string, contexto = "") {
  assert.equal(r.status, http, `${contexto} ${r.texto}`);
  assert.equal(r.cuerpo.error.codigo, codigo, `${contexto} ${r.texto}`);
}

const numeros = (r: Respuesta) => r.cuerpo.facturas.map((f: { numero: string }) => f.numero);

test("permisos: solo un gestor genera y consulta facturas, con 401 NO_IDENTIFICADO sin X-Socio y 403 SIN_PERMISO si no es gestor", async () => {
  await conApi("2026-11-18T10:00", async (api) => {
    esError(await generarComo(api, undefined, "2026-10"), 401, "NO_IDENTIFICADO");
    esError(await generarComo(api, "socio-003", "2026-10"), 403, "SIN_PERMISO");
    assert.equal((await generar(api, "2026-10")).status, 201);
    for (const ruta of ["/api/facturas?mes=2026-10", "/api/facturas/F2026-0003"]) {
      esError(await api.pedir("GET", ruta), 401, "NO_IDENTIFICADO", ruta);
      // F2026-0003 es la factura de socio-003: tampoco puede verla.
      esError(await api.pedir("GET", ruta, { socio: "socio-003" }), 403, "SIN_PERMISO", ruta);
      assert.equal((await api.pedir("GET", ruta, { socio: GESTOR })).status, 200, ruta);
    }
  });
});

test("mes cerrado: mes con el formato AAAA-MM o 400 DATOS_INVALIDOS, y 409 MES_ABIERTO hasta las 00:00 del día 1 del mes siguiente", async () => {
  for (const TZ of ["Europe/Madrid", "UTC"]) {
    await conApi("2026-11-30T23:59", async (api) => {
      for (const mes of ["2026-1", "2026/10", "2026-10-01", "2026-13", "octubre", 202610, undefined]) {
        esError(await generar(api, mes), 400, "DATOS_INVALIDOS", `mes=${mes}`);
      }
      esError(await generar(api, "2026-11"), 409, "MES_ABIERTO", `${TZ}, 30 de noviembre a las 23:59`);
      esError(await generar(api, "2027-01"), 409, "MES_ABIERTO", TZ);
      await moverReloj(api, "2026-12-01T00:00");
      assert.equal((await generar(api, "2026-11")).status, 201, `${TZ}, 1 de diciembre a las 00:00`);
      esError(await generar(api, "2026-12"), 409, "MES_ABIERTO", TZ);
    }, { TZ });
  }
});

test("octubre de 2026: una factura por socio con algo que facturar, ordenadas por socio, también los socios sin cuota y la recepción", async () => {
  await conApi("2026-11-18T10:00", async (api) => {
    const { reservas } = (await api.pedir("GET", "/_estado")).cuerpo as { reservas: Reserva[] };
    const octubre = reservas.filter((r) => r.inicio.startsWith("2026-10"));
    const r = await generar(api, "2026-10");
    assert.equal(r.status, 201);
    const facturas = r.cuerpo.facturas;
    // Todos los socios menos Nora Benítez (socio-041), que no tiene reservas.
    assert.deepEqual(facturas.map((f: { socioId: string }) => f.socioId), Array.from({ length: 40 }, (_, i) => `socio-${String(i + 1).padStart(3, "0")}`));
    for (const factura of facturas) {
      const suyas = octubre.filter((x) => x.socioId === factura.socioId && x.estado !== "cancelada")
        .sort((a, b) => (a.inicio === b.inicio ? (a.id < b.id ? -1 : 1) : a.inicio < b.inicio ? -1 : 1));
      assert.equal(factura.mes, "2026-10");
      assert.deepEqual(factura.lineas, suyas.map((x) => ({ reservaId: x.id, concepto: "Reserva", importe: x.importe })), factura.socioId);
    }
    // 315 reservas en octubre, 25 de ellas canceladas sin penalización: 290 líneas por 6.350,00 €.
    assert.equal(facturas.reduce((n: number, f: { lineas: unknown[] }) => n + f.lineas.length, 0), 290);
    assert.equal(facturas.reduce((n: number, f: { total: number }) => n + f.total, 0), 635000);
    assert.deepEqual(facturas[0], {
      numero: "F2026-0001",
      mes: "2026-10",
      socioId: "socio-001",
      lineas: [
        { reservaId: "R-0120", concepto: "Reserva", importe: 1800 },
        { reservaId: "R-0172", concepto: "Reserva", importe: 2800 },
        { reservaId: "R-0193", concepto: "Reserva", importe: 2200 },
      ],
      total: 6800,
      base: 5620,
      iva: 1180,
    });
  });
});

test("líneas: por el inicio de la reserva, las canceladas con penalización por su penalización y las canceladas gratis, fuera", async () => {
  await conApi("2027-02-01T10:00", async (api) => {
    // socio-003 reserva en otro orden que el de los inicios.
    const sabado = await reservar(api, "socio-003", "pista-1", "2027-02-20T10:30"); // 28 €
    const miercoles = await reservar(api, "socio-003", "pista-2", "2027-02-03T18:00"); // 28 €
    const valle = await reservar(api, "socio-003", "pista-3", "2027-02-10T12:00"); // 12 €
    const penalizada = await reservar(api, "socio-007", "pista-3", "2027-02-05T21:00"); // 20 €
    await cancelar(api, (await reservar(api, "socio-012", "pista-1", "2027-02-12T10:30")).id);
    await moverReloj(api, "2027-02-05T12:00");
    await cancelar(api, penalizada.id, { forzar: true });
    await moverReloj(api, "2027-03-01T00:00");

    const r = await generar(api, "2027-02");
    assert.equal(r.status, 201);
    assert.deepEqual(r.cuerpo.facturas, [
      {
        numero: "F2027-0001",
        mes: "2027-02",
        socioId: "socio-003",
        lineas: [
          { reservaId: miercoles.id, concepto: "Reserva", importe: 2800 },
          { reservaId: valle.id, concepto: "Reserva", importe: 1200 },
          { reservaId: sabado.id, concepto: "Reserva", importe: 2800 },
        ],
        total: 6800,
        base: 5620,
        iva: 1180,
      },
      { numero: "F2027-0002", mes: "2027-02", socioId: "socio-007", lineas: [{ reservaId: penalizada.id, concepto: "Penalización", importe: 2000 }], total: 2000, base: 1653, iva: 347 },
    ]);
  });
});

test("IVA: la base es el total de la factura entre 1,21, redondeado al céntimo más cercano, y no la suma de las bases de las líneas", async () => {
  await conApi("2027-02-01T10:00", async (api) => {
    await reservar(api, "socio-028", "pista-1", "2027-02-17T12:00");
    await reservar(api, "socio-028", "pista-2", "2027-02-17T12:00");
    await reservar(api, "socio-001", "pista-1", "2027-02-24T13:30");
    await moverReloj(api, "2027-03-01T10:00");
    const r = await generar(api, "2027-02");
    const cuentas = r.cuerpo.facturas.map((f: { socioId: string; total: number; base: number; iva: number }) => [f.socioId, f.total, f.base, f.iva]);
    // 18 € / 1,21 = 14,876 € → 14,88 € (hacia abajo serían 14,87 €). 36 € / 1,21 = 29,752 € → 29,75 €, no 2 × 14,88 €.
    assert.deepEqual(cuentas, [["socio-001", 1800, 1488, 312], ["socio-028", 3600, 2975, 625]]);
  });
});

test("numeración: correlativa dentro del año del mes facturado, por orden de socio, siguiendo al último mes generado del año", async () => {
  await conApi("2026-11-18T10:00", async (api) => {
    const octubre = await generar(api, "2026-10");
    assert.deepEqual(numeros(octubre), Array.from({ length: 40 }, (_, i) => `F2026-${String(i + 1).padStart(4, "0")}`));
    await moverReloj(api, "2026-11-30T10:00");
    await reservar(api, "socio-020", "pista-2", "2026-12-31T21:00");
    await reservar(api, "socio-005", "pista-1", "2026-12-01T09:00");
    await moverReloj(api, "2026-12-28T10:00");
    await reservar(api, "socio-039", "pista-1", "2027-01-01T09:00");
    await moverReloj(api, "2027-02-01T10:00");

    // Enero de 2027 empieza su propia serie, aunque se genere antes que noviembre y diciembre de 2026.
    const enero = await generar(api, "2027-01");
    assert.deepEqual(enero.cuerpo.facturas.map((f: { numero: string; socioId: string }) => [f.numero, f.socioId]), [["F2027-0001", "socio-039"]]);
    // Noviembre y diciembre siguen la serie de 2026 donde la dejó octubre, aunque ya sea 2027.
    const noviembre = await generar(api, "2026-11");
    assert.deepEqual(numeros(noviembre), Array.from({ length: 40 }, (_, i) => `F2026-${String(i + 41).padStart(4, "0")}`));
    const vacio = await generar(api, "2026-09");
    assert.deepEqual(vacio.cuerpo.facturas, []);
    const diciembre = await generar(api, "2026-12");
    assert.deepEqual(diciembre.cuerpo.facturas.map((f: { numero: string; socioId: string }) => [f.numero, f.socioId]), [["F2026-0081", "socio-005"], ["F2026-0082", "socio-020"]]);
  });
});

test("generar dos veces: 201 la primera vez y 200 las siguientes, con las mismas facturas, y no se crea ninguna nueva", async () => {
  await conApi("2026-11-18T10:00", async (api) => {
    const primera = await generar(api, "2026-10");
    assert.equal(primera.status, 201);
    for (let i = 0; i < 2; i++) {
      const otra = await generar(api, "2026-10");
      assert.equal(otra.status, 200);
      assert.deepEqual(otra.cuerpo, primera.cuerpo);
    }
    assert.equal((await api.pedir("GET", "/api/facturas?mes=2026-10", { socio: GESTOR })).cuerpo.facturas.length, 40);
    await moverReloj(api, "2026-12-02T10:00");
    assert.equal(numeros(await generar(api, "2026-11"))[0], "F2026-0041");
    // Un mes sin facturas también queda generado.
    assert.equal((await generar(api, "2026-09")).status, 201);
    assert.equal((await generar(api, "2026-09")).status, 200);
  });
});

test("consultar: las facturas de un mes generado, una lista vacía si no se ha generado y 404 FACTURA_NO_ENCONTRADA", async () => {
  await conApi("2026-11-18T10:00", async (api) => {
    const consultar = (ruta: string) => api.pedir("GET", ruta, { socio: GESTOR });
    assert.deepEqual((await consultar("/api/facturas?mes=2026-10")).cuerpo, { facturas: [] });
    esError(await consultar("/api/facturas/F2026-0001"), 404, "FACTURA_NO_ENCONTRADA");
    const generadas = (await generar(api, "2026-10")).cuerpo.facturas;
    assert.deepEqual((await consultar("/api/facturas?mes=2026-10")).cuerpo, { facturas: generadas });
    assert.deepEqual((await consultar("/api/facturas?mes=2025-10")).cuerpo, { facturas: [] });
    assert.deepEqual((await consultar("/api/facturas/F2026-0040")).cuerpo, { factura: generadas[39] });
    for (const numero of ["F2026-0041", "F2027-0001", "F2026-0000"]) esError(await consultar(`/api/facturas/${numero}`), 404, "FACTURA_NO_ENCONTRADA", numero);
    esError(await consultar("/api/facturas?mes=octubre"), 400, "DATOS_INVALIDOS");
  });
});

test("lo demás no cambia: generar y consultar facturas no toca las reservas, y se sigue reservando y cancelando igual", async () => {
  await conApi("2026-11-18T10:00", async (api) => {
    const antes = (await api.pedir("GET", "/_estado")).cuerpo.reservas;
    await generar(api, "2026-10");
    await api.pedir("GET", "/api/facturas?mes=2026-10", { socio: GESTOR });
    await moverReloj(api, "2026-12-02T10:00");
    await generar(api, "2026-11");
    assert.deepEqual((await api.pedir("GET", "/_estado")).cuerpo.reservas, antes);
    const nueva = await reservar(api, "socio-003", "pista-1", "2026-12-10T18:00");
    assert.equal(nueva.importe, 2800);
    await cancelar(api, nueva.id);
  });
});

test("documentación: el README explica qué se factura, el IVA, la numeración, los endpoints y los errores nuevos", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  for (const texto of ["/api/facturas", "Penalización", "IVA (21 %)", "F2026-0001", "MES_ABIERTO", "FACTURA_NO_ENCONTRADA", "SIN_PERMISO"]) {
    assert.ok(readme.includes(texto), `el README no menciona ${texto}`);
  }
});
