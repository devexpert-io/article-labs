// Tests ocultos de la spec `facturas`: generar dos veces (C7). Volver a generar un mes ya generado devuelve las mismas
// facturas, con los mismos números, y no crea ninguna nueva. Responde 201 la primera vez y 200 las siguientes.
// Caja negra: solo la API HTTP, con /_reloj para cerrar noviembre. De cada factura se comparan los campos que fija la
// spec (puede traer otros), sin mirar en qué orden llegan, que es de C3.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

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

/** Genera un mes como gestor, comprueba el código HTTP (si se da) y devuelve sus facturas. */
async function generar(api: Api, mes: string, http: 200 | 201 | undefined, contexto: string): Promise<any[]> {
  const r = await api.pedir("POST", "/api/facturas", { cuerpo: { mes }, socio: GESTOR });
  if (http) assert.equal(r.status, http, `${contexto}: esperaba ${http} y llegó ${r.status}: ${r.texto.slice(0, 300)}`);
  else assert.ok(r.status === 201 || r.status === 200, `${contexto}: esperaba 201 o 200 y llegó ${r.status}: ${r.texto.slice(0, 300)}`);
  assert.ok(Array.isArray(r.cuerpo?.facturas), `${contexto} debe responder { facturas }: ${r.texto.slice(0, 300)}`);
  return r.cuerpo.facturas;
}

test("C7 · generar otra vez un mes ya generado responde 200 con las mismas facturas y los mismos números, y solo la primera vez responde 201", OPCIONES, async () => {
  await conApi(async (api) => {
    const octubre = porSocio(await generar(api, "2026-10", 201, "octubre, la primera vez"));
    assert.ok(octubre.length > 0, "octubre tiene facturas");
    assert.deepEqual(porSocio(await generar(api, "2026-10", 200, "octubre, la segunda vez")), octubre, "octubre, la segunda vez");
    assert.deepEqual(porSocio(await generar(api, "2026-10", 200, "octubre, la tercera vez")), octubre, "octubre, la tercera vez");

    await reloj(api, "2026-12-02T10:00");
    const noviembre = porSocio(await generar(api, "2026-11", 201, "noviembre, la primera vez"));
    assert.ok(noviembre.length > 0, "noviembre tiene facturas");
    assert.deepEqual(porSocio(await generar(api, "2026-10", 200, "octubre, después de generar noviembre")), octubre, "octubre, después de generar noviembre");
    assert.deepEqual(porSocio(await generar(api, "2026-11", 200, "noviembre, la segunda vez")), noviembre, "noviembre, la segunda vez");

    await reloj(api, "2027-03-01T10:00");
    assert.deepEqual(porSocio(await generar(api, "2026-10", 200, "octubre, meses después")), octubre, "octubre, meses después");
  });
});

test("C7 · generar otra vez no crea facturas nuevas: el mes que se genera después se numera igual que si no se hubiera repetido", OPCIONES, async () => {
  // Dos clubs iguales: en uno se genera octubre tres veces y en el otro una. Noviembre tiene que salir igual en los dos.
  const noviembreDe = async (veces: number) => {
    let noviembre: any[] = [];
    await conApi(async (api) => {
      for (let i = 0; i < veces; i++) await generar(api, "2026-10", undefined, `octubre, vez ${i + 1}`);
      await reloj(api, "2026-12-02T10:00");
      noviembre = porSocio(await generar(api, "2026-11", undefined, "noviembre"));
    });
    return noviembre;
  };
  const [repitiendo, sinRepetir] = await Promise.all([noviembreDe(3), noviembreDe(1)]);
  assert.ok(sinRepetir.length > 0, "noviembre tiene facturas");
  assert.deepEqual(repitiendo.map((f) => f.numero), sinRepetir.map((f) => f.numero), "los números de noviembre después de generar octubre tres veces");
});
