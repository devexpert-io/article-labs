// Tests ocultos de exportar-csv, criterio 10 (lo demás no cambia). Comparan GET /api/reservas con lo que responde la
// base: las tablas de abajo salen de hacer estas mismas peticiones a club/ sin la feature, con su semilla.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test, type TestContext } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

const GESTOR = "socio-040";
/** Si la API se cuelga, el test falla a los 30 segundos y la API se cierra. */
const OPCIONES = { timeout: 30_000 };

/** Una respuesta 200 de la base: un resumen legible y la huella del cuerpo entero. */
interface Listado {
  ruta: string;
  socio?: string;
  resumen: string;
  huella: string;
}

/** Una respuesta de error de la base: su status y su código (el mensaje no cuenta). */
interface ErrorBase {
  ruta: string;
  socio?: string;
  status: number;
  codigo: string;
}

const LISTADOS_BASE: Listado[] = [
  { ruta: "/api/reservas", resumen: "total=525 pagina=1 paginas=11 reservas=50", huella: "10aaa0cce0a0f343" },
  { ruta: "/api/reservas", socio: "socio-001", resumen: "total=525 pagina=1 paginas=11 reservas=50", huella: "10aaa0cce0a0f343" },
  { ruta: "/api/reservas", socio: "socio-040", resumen: "total=525 pagina=1 paginas=11 reservas=50", huella: "10aaa0cce0a0f343" },
  { ruta: "/api/reservas?limite=100&pagina=3", resumen: "total=525 pagina=3 paginas=6 reservas=100", huella: "6fc4f0ad17290912" },
  { ruta: "/api/reservas?desde=2026-11-01&hasta=2026-11-30&limite=100&pagina=2", socio: "socio-040", resumen: "total=210 pagina=2 paginas=3 reservas=100", huella: "915ad3d4094948ad" },
  { ruta: "/api/reservas?fecha=2026-11-19&limite=100", resumen: "total=7 pagina=1 paginas=1 reservas=7", huella: "04086dbac36dd98e" },
  { ruta: "/api/reservas?estado=cancelada&limite=100", resumen: "total=36 pagina=1 paginas=1 reservas=36", huella: "ed219b5b3f85a0bc" },
  { ruta: "/api/reservas?estado=no_presentada&desde=2026-10-01&hasta=2026-10-31", socio: "socio-041", resumen: "total=22 pagina=1 paginas=1 reservas=22", huella: "0c8002ec3370841f" },
  { ruta: "/api/reservas?socio=socio-005&pista=pista-1", resumen: "total=5 pagina=1 paginas=1 reservas=5", huella: "501d5835c2e9fe83" },
  { ruta: "/api/reservas?pista=pista-4&estado=confirmada&limite=7&pagina=2", resumen: "total=83 pagina=2 paginas=12 reservas=7", huella: "dc9df9dbaa091188" },
  { ruta: "/api/reservas?desde=2026-11-20&hasta=2026-11-10", resumen: "total=0 pagina=1 paginas=1 reservas=0", huella: "fe2eec2852af28df" },
  { ruta: "/api/reservas?desde=2026-08-01&hasta=2026-12-31&limite=100&pagina=6", resumen: "total=525 pagina=6 paginas=6 reservas=25", huella: "c4d6a084026796f4" },
  { ruta: "/api/reservas?desde=2026-11-15", resumen: "total=64 pagina=1 paginas=2 reservas=50", huella: "df55934c709545b0" },
  { ruta: "/api/reservas?hasta=2026-10-02", socio: "socio-040", resumen: "total=16 pagina=1 paginas=1 reservas=16", huella: "232ecfaff090931b" },
  { ruta: "/api/reservas?desde=2026-02-30&hasta=2026-13-45&limite=1", resumen: "total=525 pagina=1 paginas=525 reservas=1", huella: "37378f030c8506b2" },
  { ruta: "/api/reservas?pagina=99", resumen: "total=525 pagina=99 paginas=11 reservas=0", huella: "d39f403fc8fec3ff" },
  { ruta: "/api/reservas/R-0520", resumen: "reserva=R-0520", huella: "3f14dc19b3f1ff42" },
  { ruta: "/api/reservas/R-0001", socio: "socio-040", resumen: "reserva=R-0001", huella: "d9fe92bf40f82681" },
];
const ERRORES_BASE: ErrorBase[] = [
  { ruta: "/api/reservas?estado=pendiente", status: 400, codigo: "DATOS_INVALIDOS" },
  { ruta: "/api/reservas?limite=0", status: 400, codigo: "DATOS_INVALIDOS" },
  { ruta: "/api/reservas?limite=101", socio: "socio-040", status: 400, codigo: "DATOS_INVALIDOS" },
  { ruta: "/api/reservas?limite=diez", status: 400, codigo: "DATOS_INVALIDOS" },
  { ruta: "/api/reservas?pagina=0", status: 400, codigo: "DATOS_INVALIDOS" },
  { ruta: "/api/reservas?desde=2026/11/01", status: 400, codigo: "DATOS_INVALIDOS" },
  { ruta: "/api/reservas?fecha=hoy", status: 400, codigo: "DATOS_INVALIDOS" },
  { ruta: "/api/reservas", socio: "socio-999", status: 401, codigo: "NO_IDENTIFICADO" },
  { ruta: "/api/reservas/R-9999", status: 404, codigo: "RESERVA_NO_ENCONTRADA" },
];

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

/** El JSON con las claves ordenadas: el orden de las claves de un objeto no cambia la respuesta. */
function canonico(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(canonico);
  if (valor !== null && typeof valor === "object") {
    return Object.fromEntries(Object.keys(valor).sort().map((k) => [k, canonico((valor as Record<string, unknown>)[k])]));
  }
  return valor;
}

function huella(valor: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonico(valor))).digest("hex").slice(0, 16);
}

function resumen(cuerpo: any): string {
  if (cuerpo && typeof cuerpo === "object" && "total" in cuerpo) {
    return `total=${cuerpo.total} pagina=${cuerpo.pagina} paginas=${cuerpo.paginas} reservas=${cuerpo.reservas?.length}`;
  }
  if (cuerpo?.reserva) return `reserva=${cuerpo.reserva.id}`;
  return typeof cuerpo;
}

/** Para crear reservas: elige socios con la cuota al día y hueco (como mucho 3 reservas futuras confirmadas). */
async function preparadorDeReservas(api: Api) {
  const e = (await api.pedir("GET", "/_estado")).cuerpo;
  const huecos = new Map<string, number>();
  for (const s of e.socios) {
    if (!s.cuotaActiva) continue;
    const futuras = e.reservas.filter((r: any) => r.socioId === s.id && r.estado === "confirmada" && r.inicio > e.ahora).length;
    if (futuras < 3) huecos.set(s.id, 3 - futuras);
  }
  return async (pistaId: string, inicio: string): Promise<{ id: string }> => {
    const socioId = [...huecos.keys()].find((id) => huecos.get(id)! > 0);
    assert.ok(socioId, "no queda ningún socio con hueco para reservar");
    huecos.set(socioId, huecos.get(socioId)! - 1);
    const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio } });
    assert.equal(r.status, 201, `no se pudo crear la reserva de ${pistaId} del ${inicio}: ${r.texto}`);
    return r.cuerpo.reserva;
  };
}

test("C10 · GET /api/reservas y GET /api/reservas/:id responden lo mismo que en la base, con X-Socio o sin él", OPCIONES, (t) => conApi(t, async (api) => {
  for (const { ruta, socio, resumen: esperado, huella: huellaBase } of LISTADOS_BASE) {
    const caso = `${ruta}${socio ? ` (X-Socio: ${socio})` : ""}`;
    const r = await api.pedir("GET", ruta, socio ? { socio } : {});
    assert.equal(r.status, 200, `${caso}: ${r.texto.slice(0, 300)}`);
    assert.equal((r.cabeceras.get("content-type") ?? "").toLowerCase().replace(/\s+/g, ""), "application/json;charset=utf-8", caso);
    assert.equal(resumen(r.cuerpo), esperado, caso);
    assert.equal(huella(r.cuerpo), huellaBase, `${caso}: el cuerpo no es el mismo que en la base`);
  }
}));

test("C10 · los errores de GET /api/reservas no cambian", OPCIONES, (t) => conApi(t, async (api) => {
  for (const { ruta, socio, status, codigo } of ERRORES_BASE) {
    const caso = `${ruta}${socio ? ` (X-Socio: ${socio})` : ""}`;
    const r = await api.pedir("GET", ruta, socio ? { socio } : {});
    assert.equal(r.status, status, `${caso}: ${r.texto.slice(0, 300)}`);
    assert.equal(r.cuerpo?.error?.codigo, codigo, caso);
  }
}));

test("C10 · después de exportar, GET /api/reservas responde lo mismo que antes", OPCIONES, (t) => conApi(t, async (api) => {
  // Creadas en desorden: GET /api/reservas las da en el orden en que se crearon, como en la base.
  const reservar = await preparadorDeReservas(api);
  const creadas = [];
  for (const [pistaId, inicio] of [["pista-2", "2026-12-03T09:00"], ["pista-3", "2026-12-02T09:00"], ["pista-1", "2026-12-02T09:00"]]) {
    creadas.push(await reservar(pistaId!, inicio!));
  }
  const listar = async () => {
    const primera = (await api.pedir("GET", "/api/reservas?limite=100")).cuerpo;
    const paginas = [primera];
    for (let pagina = 2; pagina <= primera.paginas; pagina++) paginas.push((await api.pedir("GET", `/api/reservas?limite=100&pagina=${pagina}`)).cuerpo);
    const diciembre = (await api.pedir("GET", "/api/reservas?desde=2026-12-01&hasta=2026-12-31")).cuerpo;
    return { paginas, diciembre };
  };
  const antes = await listar();
  assert.deepEqual(antes.diciembre.reservas.map((r: { id: string }) => r.id), creadas.map((r) => r.id), "GET /api/reservas da las reservas en el orden en que se crearon");
  for (const consulta of ["desde=2026-10-01&hasta=2026-11-30", "desde=2026-12-01&hasta=2026-12-31", "desde=2026-11-19&hasta=2026-12-03&estado=confirmada"]) {
    await api.pedir("GET", `/api/reservas/exportar?${consulta}`, { socio: GESTOR });
  }
  assert.deepEqual(await listar(), antes, "exportar ha cambiado lo que responde GET /api/reservas");
}));
