// Tests ampliados de la spec `facturas`: una prueba por clase de defecto de comportamiento confirmada en la revisión a
// mano, para pasarla por todos los estados del encargo. Caja negra: solo la API HTTP, con /_reloj y el reloj fijado con
// AHORA y TZ. Cada prueba arranca su propia API y no depende de las demás.
//   X1: la semilla de la base no cambia (facturas-luna-r1 añadía una penalización a R-0012). Lo esperado sale de la base
//       del club, no del /_estado de la implementación.
//   X2: un mes cerrado sin nada que facturar también queda generado (facturas-luna-r2 respondía 201 cada vez).
//   X3: el mes cerrado se decide bien en los extremos del formato AAAA-MM (facturas-luna-r1, -r2 y -r3 facturaban 9999-12
//       y -r2 y -r3 rechazaban meses ya terminados de años anteriores al 1000).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

const GESTOR = "socio-040";
const OPCIONES = { timeout: 60_000 };

const abiertas = new Set<Api>();
after(() => abiertas.forEach((api) => api.cerrar()));

async function conApi(entorno: Record<string, string>, prueba: (api: Api) => Promise<void>) {
  const api = await arrancarApi(entorno);
  abiertas.add(api);
  try {
    await prueba(api);
  } finally {
    api.cerrar();
    abiertas.delete(api);
  }
}

function generar(api: Api, mes: unknown) {
  return api.pedir("POST", "/api/facturas", { cuerpo: { mes }, socio: GESTOR });
}

function esError(r: Respuesta, http: number, codigo: string, contexto = "") {
  assert.equal(r.status, http, `${contexto} esperaba ${http} ${codigo} y llegó ${r.status}: ${r.texto.slice(0, 300)}`);
  assert.equal(r.cuerpo?.error?.codigo, codigo, `${contexto} ${r.texto.slice(0, 300)}`);
}

/** Un mes cerrado se genera: 201 la primera vez o 200 si ya estaba, con { facturas }. */
function seGenera(r: Respuesta, contexto: string) {
  assert.ok(r.status === 201 || r.status === 200, `${contexto} esperaba 201 o 200 y llegó ${r.status}: ${r.texto.slice(0, 300)}`);
  assert.ok(Array.isArray(r.cuerpo?.facturas), `${contexto} debe responder { facturas }: ${r.texto.slice(0, 300)}`);
}

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const normalizar = (texto: unknown) => (typeof texto === "string" ? texto.normalize("NFC") : texto);

// --- X1: datos de la semilla de la base -----------------------------------------------------------------------------

/**
 * Las 525 reservas de la semilla de la base (club/), con la hora de la semilla: la huella SHA-256 de sus campos de la base
 * (sin penalización o con 0 cuenta igual), cuántas hay de cada estado con la suma de sus importes, y las líneas que
 * facturaría la base a socio-029 en octubre de 2026: sus confirmadas y no presentadas. Sus dos canceladas de octubre
 * (R-0012 y R-0246) no tienen penalización en la base, así que no se facturan.
 */
const BASE = {
  huella: "30ecb424fa629618a8d2677a1f713e2ada472f4e9402ab738fee8aa093878fae",
  porEstado: {
    cancelada: { n: 36, importe: 77600 },
    confirmada: { n: 458, importe: 1027600 },
    no_presentada: { n: 31, importe: 69600 },
  },
  octubreSocio029: [
    { reservaId: "R-0025", concepto: "Reserva", importe: 2200 },
    { reservaId: "R-0056", concepto: "Reserva", importe: 1200 },
    { reservaId: "R-0110", concepto: "Reserva", importe: 2000 },
    { reservaId: "R-0140", concepto: "Reserva", importe: 2800 },
    { reservaId: "R-0188", concepto: "Reserva", importe: 2800 },
    { reservaId: "R-0252", concepto: "Reserva", importe: 2200 },
    { reservaId: "R-0305", concepto: "Reserva", importe: 2800 },
    { reservaId: "R-0307", concepto: "Reserva", importe: 2000 },
  ],
};

/** Todas las reservas, página a página, como las lista GET /api/reservas. */
async function listarTodas(api: Api): Promise<any[]> {
  const todas: any[] = [];
  for (let pagina = 1; ; pagina++) {
    const r = await api.pedir("GET", `/api/reservas?limite=100&pagina=${pagina}`);
    assert.equal(r.status, 200, r.texto.slice(0, 300));
    todas.push(...r.cuerpo.reservas);
    if (pagina >= r.cuerpo.paginas) return todas;
  }
}

/** La huella de los campos de la base de las reservas, ordenadas por id. Sin penalización, null o 0 cuentan igual. */
function huella(reservas: any[]): string {
  const filas = reservas
    .map((r) => [r.id, r.socioId, r.pistaId, r.inicio, r.fin, r.estado, r.importe, r.notas, (r.penalizacion ?? 0) || null, r.motivoCancelacion ?? null])
    .sort((a, b) => comparar(String(a[0]), String(b[0])));
  return createHash("sha256").update(JSON.stringify(filas)).digest("hex");
}

test("X1 · las reservas de la semilla siguen como en la base y la factura de octubre de socio-029 solo lleva lo que facturaría la base (C9)", OPCIONES, async () => {
  await conApi({ AHORA: "2026-11-18T10:00", TZ: "UTC" }, async (api) => {
    const reservas = await listarTodas(api);
    const conPenalizacion = reservas.filter((r) => (r.penalizacion ?? 0) > 0).map((r) => `${r.id} (${r.estado}, ${r.penalizacion})`);
    assert.deepEqual(conPenalizacion, [], "en la semilla de la base ninguna reserva tiene penalización");
    const porEstado: Record<string, { n: number; importe: number }> = {};
    for (const r of reservas) {
      porEstado[r.estado] ??= { n: 0, importe: 0 };
      porEstado[r.estado]!.n += 1;
      porEstado[r.estado]!.importe += r.importe;
    }
    assert.deepEqual(porEstado, BASE.porEstado, "las reservas de la semilla por estado, con la suma de sus importes, como en la base");
    assert.equal(huella(reservas), BASE.huella, "los campos de la base de las reservas de la semilla, como en la base");

    // La factura de octubre de socio-029 con los datos de la base. El orden de las líneas es de C4: aquí no se mira.
    const r = await generar(api, "2026-10");
    seGenera(r, "generar 2026-10:");
    const factura = r.cuerpo.facturas.find((f: any) => f?.socioId === "socio-029");
    assert.ok(factura, `socio-029 tiene reservas que facturar en octubre: ${r.texto.slice(0, 300)}`);
    const lineas = (Array.isArray(factura.lineas) ? factura.lineas : []).map((l: any) => ({ reservaId: l?.reservaId, concepto: normalizar(l?.concepto), importe: l?.importe }));
    const porReserva = (ls: any[]) => [...ls].sort((a, b) => comparar(String(a.reservaId), String(b.reservaId)));
    assert.deepEqual(porReserva(lineas), porReserva(BASE.octubreSocio029), "las líneas de la factura de octubre de socio-029, con los datos de la base");
  });
});

// --- X2: un mes sin nada que facturar también queda generado --------------------------------------------------------

test("X2 · volver a generar un mes cerrado sin nada que facturar responde 200 con la lista vacía (C7)", OPCIONES, async () => {
  // El historial de la semilla empieza el 1 de octubre de 2026: septiembre de 2026 y marzo de 2025 no tienen reservas.
  await conApi({ AHORA: "2026-11-18T10:00", TZ: "UTC" }, async (api) => {
    for (const mes of ["2026-09", "2025-03"]) {
      // La primera vez la spec pide 201. Aquí se acepta también 200: lo que se mira es la repetición.
      const primera = await generar(api, mes);
      seGenera(primera, `${mes}, la primera vez:`);
      assert.deepEqual(primera.cuerpo.facturas, [], `${mes} no tiene nada que facturar`);
      for (const vez of ["segunda", "tercera"]) {
        const otra = await generar(api, mes);
        assert.equal(otra.status, 200, `${mes}, la ${vez} vez: esperaba 200 y llegó ${otra.status}: ${otra.texto.slice(0, 300)}`);
        assert.deepEqual(otra.cuerpo?.facturas, [], `${mes}, la ${vez} vez: las mismas facturas, ninguna`);
      }
    }
  });
});

// --- X3: el mes cerrado en los extremos del formato AAAA-MM -----------------------------------------------------------

test("X3 · un mes que no ha terminado responde 409 MES_ABIERTO y uno terminado se genera, también en los años extremos de AAAA-MM (C2)", OPCIONES, async () => {
  await conApi({ AHORA: "2026-11-18T10:00", TZ: "UTC" }, async (api) => {
    for (const mes of ["9999-12", "9999-01", "2100-12"]) esError(await generar(api, mes), 409, "MES_ABIERTO", `${mes} con el club a 2026-11-18T10:00:`);
    for (const mes of ["0999-10", "0999-12", "1000-01", "1999-12"]) seGenera(await generar(api, mes), `${mes} con el club a 2026-11-18T10:00:`);
  });
  await conApi({ AHORA: "1000-01-01T00:00", TZ: "UTC" }, async (api) => {
    for (const mes of ["0999-01", "0999-12"]) seGenera(await generar(api, mes), `${mes} con el club a 1000-01-01T00:00:`);
    for (const mes of ["1000-01", "1000-02", "9999-12"]) esError(await generar(api, mes), 409, "MES_ABIERTO", `${mes} con el club a 1000-01-01T00:00:`);
  });
});
