// Tests ocultos de exportar-csv, criterio 1 (permisos). Caja negra: solo la API HTTP.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

const GESTOR = "socio-040";
const CONSULTA = "desde=2026-11-01&hasta=2026-11-30";
/** Si la API se cuelga, el test falla a los 30 segundos y la API se cierra. */
const OPCIONES = { timeout: 30_000 };

/** Arranca una API solo para este test, con la hora de Madrid (la del club), y la cierra al terminar. */
async function conApi(t: TestContext, prueba: (api: Api) => Promise<void>): Promise<void> {
  const api = await arrancarApi({ TZ: "Europe/Madrid" });
  t.signal.addEventListener("abort", () => api.cerrar(), { once: true });
  try {
    await prueba(api);
  } finally {
    api.cerrar();
  }
}

/** Pide la exportación como el gestor, como otro socio o, con null, sin cabecera X-Socio. */
function exportar(api: Api, consulta: string, socio: string | null = GESTOR) {
  return api.pedir("GET", `/api/reservas/exportar?${consulta}`, socio === null ? {} : { socio });
}

test("C1 · el gestor puede exportar", OPCIONES, (t) => conApi(t, async (api) => {
  const r = await exportar(api, CONSULTA);
  assert.ok(r.status >= 200 && r.status < 300, `${r.status} ${r.texto.slice(0, 300)}`);
}));

test("C1 · sin X-Socio, o con un id que no es de ningún socio, responde 401 NO_IDENTIFICADO", OPCIONES, (t) => conApi(t, async (api) => {
  for (const socio of [null, "socio-999"]) {
    const r = await exportar(api, CONSULTA, socio);
    const quien = socio ?? "sin X-Socio";
    assert.equal(r.status, 401, `${quien}: ${r.texto.slice(0, 300)}`);
    assert.equal(r.cuerpo?.error?.codigo, "NO_IDENTIFICADO", quien);
  }
}));

test("C1 · un socio que no es gestor recibe 403 SIN_PERMISO", OPCIONES, (t) => conApi(t, async (api) => {
  // En la semilla, socio-040 es el único gestor: todos los demás, de socio-001 a socio-041, son socios normales.
  const socios = Array.from({ length: 41 }, (_, i) => `socio-${String(i + 1).padStart(3, "0")}`).filter((id) => id !== GESTOR);
  for (const socio of socios) {
    const r = await exportar(api, CONSULTA, socio);
    assert.equal(r.status, 403, `${socio}: ${r.texto.slice(0, 300)}`);
    assert.equal(r.cuerpo?.error?.codigo, "SIN_PERMISO", socio);
  }
}));
