// Tests ocultos de la spec `facturas`: permisos (C1). Solo un gestor genera y consulta facturas.
// Caja negra: solo la API HTTP. Los permisos se prueban con un mes cerrado y con facturas que existen, para que el
// único motivo para rechazar la petición sea quién la hace.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

const GESTOR = "socio-040";
const OPCIONES = { timeout: 30_000 };
/** Socios que no son gestores: uno con la cuota al día, otro sin ella y la socia que se acaba de dar de alta. */
const NO_GESTORES = ["socio-003", "socio-011", "socio-041"];

const abiertas = new Set<Api>();
after(() => abiertas.forEach((api) => api.cerrar()));

/** Una API solo para esta prueba, con la hora de la semilla (18 de noviembre de 2026): octubre está cerrado. */
async function conApi(prueba: (api: Api) => Promise<void>) {
  const api = await arrancarApi({ TZ: "UTC" });
  abiertas.add(api);
  try {
    const estado = (await api.pedir("GET", "/_estado")).cuerpo;
    for (const id of NO_GESTORES) {
      assert.equal(estado.socios.find((s: { id: string }) => s.id === id)?.rol, "socio", `${id} no es gestor en la semilla`);
    }
    await prueba(api);
  } finally {
    api.cerrar();
    abiertas.delete(api);
  }
}

function esError(r: Respuesta, http: number, codigo: string, contexto = "") {
  assert.equal(r.status, http, `${contexto} esperaba ${http} ${codigo} y llegó ${r.status}: ${r.texto.slice(0, 300)}`);
  assert.equal(r.cuerpo?.error?.codigo, codigo, `${contexto} ${r.texto.slice(0, 300)}`);
}

function generar(api: Api, mes: string, socio?: string) {
  return api.pedir("POST", "/api/facturas", { cuerpo: { mes }, socio });
}

/** Genera octubre como gestor (201 o 200 da igual aquí: es de C7) y devuelve sus facturas. */
async function generarOctubre(api: Api): Promise<any[]> {
  const r = await generar(api, "2026-10", GESTOR);
  assert.ok(r.status === 201 || r.status === 200, `el gestor genera octubre: ${r.status} ${r.texto.slice(0, 300)}`);
  return Array.isArray(r.cuerpo?.facturas) ? r.cuerpo.facturas : [];
}

test("C1 · generar facturas es solo para gestores: 401 NO_IDENTIFICADO sin X-Socio y 403 SIN_PERMISO con un socio que no es gestor, también si el mes ya está generado", OPCIONES, async () => {
  await conApi(async (api) => {
    esError(await generar(api, "2026-10"), 401, "NO_IDENTIFICADO", "sin X-Socio:");
    for (const socio of NO_GESTORES) esError(await generar(api, "2026-10", socio), 403, "SIN_PERMISO", `como ${socio}:`);
    await generarOctubre(api);
    // Ya generado: repetirlo tampoco es para cualquiera.
    esError(await generar(api, "2026-10"), 401, "NO_IDENTIFICADO", "sin X-Socio, con octubre ya generado:");
    for (const socio of NO_GESTORES) esError(await generar(api, "2026-10", socio), 403, "SIN_PERMISO", `como ${socio}, con octubre ya generado:`);
  });
});

test("C1 · consultar las facturas de un mes es solo para gestores: 401 NO_IDENTIFICADO sin X-Socio y 403 SIN_PERMISO con un socio que no es gestor", OPCIONES, async () => {
  await conApi(async (api) => {
    const consultar = (socio?: string) => api.pedir("GET", "/api/facturas?mes=2026-10", { socio });
    esError(await consultar(), 401, "NO_IDENTIFICADO", "sin X-Socio, antes de generar:");
    for (const socio of NO_GESTORES) esError(await consultar(socio), 403, "SIN_PERMISO", `como ${socio}, antes de generar:`);
    await generarOctubre(api);
    esError(await consultar(), 401, "NO_IDENTIFICADO", "sin X-Socio:");
    for (const socio of NO_GESTORES) esError(await consultar(socio), 403, "SIN_PERMISO", `como ${socio}:`);
    const delGestor = await consultar(GESTOR);
    assert.equal(delGestor.status, 200, `el gestor consulta octubre: ${delGestor.texto.slice(0, 300)}`);
  });
});

test("C1 · consultar una factura por su número es solo para gestores, también la del propio socio: 401 NO_IDENTIFICADO sin X-Socio y 403 SIN_PERMISO", OPCIONES, async () => {
  await conApi(async (api) => {
    const facturas = await generarOctubre(api);
    const propias = NO_GESTORES.map((socio) => facturas.find((f) => f?.socioId === socio)).filter(Boolean);
    assert.ok(propias.length > 0, "algún socio de la prueba tiene factura en octubre");
    for (const factura of propias) {
      const ruta = `/api/facturas/${encodeURIComponent(factura.numero)}`;
      esError(await api.pedir("GET", ruta), 401, "NO_IDENTIFICADO", `${factura.numero} sin X-Socio:`);
      for (const socio of NO_GESTORES) {
        esError(await api.pedir("GET", ruta, { socio }), 403, "SIN_PERMISO", `${factura.numero} (de ${factura.socioId}) como ${socio}:`);
      }
      const delGestor = await api.pedir("GET", ruta, { socio: GESTOR });
      assert.equal(delGestor.status, 200, `el gestor consulta ${factura.numero}: ${delGestor.texto.slice(0, 300)}`);
    }
  });
});
