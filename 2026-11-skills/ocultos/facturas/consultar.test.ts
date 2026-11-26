// Tests ocultos de la spec `facturas`: consultar (C8). GET /api/facturas?mes= devuelve las facturas de un mes generado
// (o una lista vacía si no se ha generado) y GET /api/facturas/:numero devuelve una factura (o 404 FACTURA_NO_ENCONTRADA).
// Caja negra: solo la API HTTP, con /_reloj para cerrar noviembre. De cada factura se comparan los campos que fija la
// spec (puede traer otros), y lo esperado es lo que devolvió la API al generar el mes. El orden de la lista es de C3.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

const GESTOR = "socio-040";
const OPCIONES = { timeout: 30_000 };

const abiertas = new Set<Api>();
after(() => abiertas.forEach((api) => api.cerrar()));

/** Una API solo para esta prueba, con la hora de la semilla (18 de noviembre de 2026): octubre está cerrado. */
async function conApi(prueba: (api: Api) => Promise<void>) {
  const api = await arrancarApi({ TZ: "UTC" });
  abiertas.add(api);
  try {
    await prueba(api);
  } finally {
    api.cerrar();
    abiertas.delete(api);
  }
}

async function reloj(api: Api, ahora: string) {
  const r = await api.pedir("POST", "/_reloj", { cuerpo: { ahora } });
  assert.equal(r.status, 200, `mover el reloj a ${ahora}: ${r.texto}`);
}

function esError(r: Respuesta, http: number, codigo: string, contexto = "") {
  assert.equal(r.status, http, `${contexto} esperaba ${http} ${codigo} y llegó ${r.status}: ${r.texto.slice(0, 300)}`);
  assert.equal(r.cuerpo?.error?.codigo, codigo, `${contexto} ${r.texto.slice(0, 300)}`);
}

const normalizar = (texto: unknown) => (typeof texto === "string" ? texto.normalize("NFC") : texto);

/** De una factura, los campos que fija la spec. */
function campos(f: any) {
  return {
    numero: f?.numero,
    mes: f?.mes,
    socioId: f?.socioId,
    lineas: Array.isArray(f?.lineas)
      ? f.lineas.map((l: any) => ({ reservaId: l?.reservaId, concepto: normalizar(l?.concepto), importe: l?.importe }))
      : f?.lineas,
    total: f?.total,
    base: f?.base,
    iva: f?.iva,
  };
}

/** Las facturas por id de socio: el orden en que llegan es de C3. */
const porSocio = (facturas: any[]) => facturas.map(campos).sort((a, b) => (String(a.socioId) < String(b.socioId) ? -1 : String(a.socioId) > String(b.socioId) ? 1 : 0));

/** Genera un mes como gestor y devuelve sus facturas. Aquí da igual si responde 201 o 200: eso es de C7. */
async function generar(api: Api, mes: string): Promise<any[]> {
  const r = await api.pedir("POST", "/api/facturas", { cuerpo: { mes }, socio: GESTOR });
  assert.ok(r.status === 201 || r.status === 200, `generar ${mes}: esperaba 201 o 200 y llegó ${r.status}: ${r.texto.slice(0, 300)}`);
  assert.ok(Array.isArray(r.cuerpo?.facturas) && r.cuerpo.facturas.length > 0, `generar ${mes} debe responder { facturas } con facturas: ${r.texto.slice(0, 300)}`);
  return r.cuerpo.facturas;
}

/** Las facturas de un mes con GET /api/facturas?mes=, como gestor. */
async function delMes(api: Api, mes: string): Promise<any[]> {
  const r = await api.pedir("GET", `/api/facturas?mes=${mes}`, { socio: GESTOR });
  assert.equal(r.status, 200, `GET /api/facturas?mes=${mes}: ${r.texto.slice(0, 300)}`);
  assert.ok(Array.isArray(r.cuerpo?.facturas), `GET /api/facturas?mes=${mes} debe responder { facturas }: ${r.texto.slice(0, 300)}`);
  return r.cuerpo.facturas;
}

async function porNumero(api: Api, numero: string) {
  return api.pedir("GET", `/api/facturas/${encodeURIComponent(numero)}`, { socio: GESTOR });
}

test("C8 · las facturas de un mes que no se ha generado son una lista vacía, también cuando ya se han generado otros meses", OPCIONES, async () => {
  await conApi(async (api) => {
    for (const mes of ["2026-10", "2026-09", "2025-10"]) assert.deepEqual(await delMes(api, mes), [], `${mes} sin generar`);
    await generar(api, "2026-10");
    // Ni el mes anterior ni el mismo mes de otro año.
    for (const mes of ["2026-09", "2025-10"]) assert.deepEqual(await delMes(api, mes), [], `${mes} sin generar, con octubre de 2026 generado`);
  });
});

test("C8 · GET /api/facturas?mes= devuelve las facturas del mes generado, las mismas que al generarlo, y solo las de ese mes", OPCIONES, async () => {
  await conApi(async (api) => {
    const octubre = porSocio(await generar(api, "2026-10"));
    assert.deepEqual(porSocio(await delMes(api, "2026-10")), octubre, "octubre");
    await reloj(api, "2026-12-02T10:00");
    const noviembre = porSocio(await generar(api, "2026-11"));
    assert.deepEqual(porSocio(await delMes(api, "2026-11")), noviembre, "noviembre");
    assert.deepEqual(porSocio(await delMes(api, "2026-10")), octubre, "octubre, con noviembre ya generado");
  });
});

test("C8 · GET /api/facturas/:numero devuelve cada factura generada, la misma que al generarla", OPCIONES, async () => {
  await conApi(async (api) => {
    const comprobar = async (facturas: any[]) => {
      for (const factura of facturas) {
        const r = await porNumero(api, factura?.numero);
        assert.equal(r.status, 200, `GET /api/facturas/${factura?.numero}: ${r.texto.slice(0, 300)}`);
        assert.deepEqual(campos(r.cuerpo?.factura), campos(factura), `la factura ${factura?.numero}`);
      }
    };
    const octubre = await generar(api, "2026-10");
    await comprobar(octubre);
    await reloj(api, "2026-12-02T10:00");
    const noviembre = await generar(api, "2026-11");
    // Si un número se repitiera entre los dos meses (eso es de C6), no hay una sola factura que devolver con él.
    const deOctubre = new Set(octubre.map((f) => f?.numero));
    await comprobar(noviembre.filter((f) => !deOctubre.has(f?.numero)));
    await comprobar(octubre.filter((f) => !noviembre.some((n) => n?.numero === f?.numero)));
  });
});

test("C8 · GET /api/facturas/:numero de una factura que no existe responde 404 FACTURA_NO_ENCONTRADA", OPCIONES, async () => {
  await conApi(async (api) => {
    esError(await porNumero(api, "F2026-0001"), 404, "FACTURA_NO_ENCONTRADA", "F2026-0001 sin nada generado:");
    const octubre = await generar(api, "2026-10");
    const ultimo = Math.max(...octubre.map((f) => Number(/^F2026-(\d{4})$/.exec(String(f?.numero))?.[1] ?? 0)));
    const siguiente = `F2026-${String(ultimo + 1).padStart(4, "0")}`;
    // Solo números que la API no ha dado: si numerara mal (eso es de C6), no se le pide uno de los suyos.
    const generados = new Set(octubre.map((f) => f?.numero));
    for (const numero of [siguiente, "F2026-0000", "F2026-9999", "F2025-0001", "F2027-0001"].filter((n) => !generados.has(n))) {
      esError(await porNumero(api, numero), 404, "FACTURA_NO_ENCONTRADA", `${numero}:`);
    }
  });
});
