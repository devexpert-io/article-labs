// Tests ocultos de la spec `facturas`: qué facturas salen (C3), sus líneas (C4) y su total, base e IVA (C5).
// Caja negra: solo la API HTTP, con /_estado y /_reloj para preparar. Lo esperado se calcula en el test a partir de las
// reservas de /_estado, y cada escenario se prueba con la API en Europe/Madrid y en UTC.
// Cada criterio mira solo lo suyo: C3 los socios y su orden (también al consultar el mes), C4 las líneas y C5 las cuentas
// de cada factura.
import assert from "node:assert/strict";
import { test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

const GESTOR = "socio-040";
const OPCIONES = { timeout: 120_000 };
const ZONAS = ["Europe/Madrid", "UTC"] as const;
const HORAS = ["09:00", "10:30", "12:00", "13:30", "15:00", "16:30", "18:00", "19:30", "21:00"];

interface Reserva {
  id: string;
  socioId: string;
  pistaId: string;
  inicio: string;
  estado: string;
  importe: number;
  penalizacion?: number;
}

interface Estado {
  ahora: string;
  pistas: { id: string; estado: string }[];
  socios: { id: string; cuotaActiva: boolean; rol: string }[];
  reservas: Reserva[];
}

interface Linea {
  reservaId: string;
  concepto: string;
  importe: number;
}

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const normalizar = (texto: unknown) => (typeof texto === "string" ? texto.normalize("NFC") : texto);

/** round(total × 100 / 121), con medio hacia arriba, en aritmética entera: floor((200 × total + 121) / 242). */
function baseEsperada(total: number): number {
  const n = 200 * total + 121;
  return (n - (n % 242)) / 242;
}

/** "Qué se factura": confirmadas y no presentadas por su importe, canceladas con penalización por su penalización. */
function lineaEsperada(r: Reserva): Linea | undefined {
  if (r.estado === "confirmada" || r.estado === "no_presentada") return { reservaId: r.id, concepto: "Reserva", importe: r.importe };
  if (r.estado === "cancelada" && (r.penalizacion ?? 0) > 0) return { reservaId: r.id, concepto: "Penalización", importe: r.penalizacion! };
  return undefined;
}

/** Las líneas que pide la spec para cada socio con algo que facturar en el mes (sin orden: el orden se mira aparte). */
function esperadas(reservas: Reserva[], mes: string): Map<string, Linea[]> {
  const porSocio = new Map<string, Linea[]>();
  for (const r of reservas) {
    const linea = r.inicio.slice(0, 7) === mes ? lineaEsperada(r) : undefined;
    if (linea) porSocio.set(r.socioId, [...(porSocio.get(r.socioId) ?? []), linea]);
  }
  return porSocio;
}

const porReserva = (lineas: Linea[]) => [...lineas].sort((a, b) => comparar(String(a.reservaId), String(b.reservaId)));

async function estadoDe(api: Api): Promise<Estado> {
  return (await api.pedir("GET", "/_estado")).cuerpo;
}

async function reloj(api: Api, ahora: string) {
  const r = await api.pedir("POST", "/_reloj", { cuerpo: { ahora } });
  assert.equal(r.status, 200, `mover el reloj a ${ahora}: ${r.texto}`);
}

async function reservar(api: Api, socioId: string, pistaId: string, inicio: string): Promise<Reserva> {
  const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio } });
  assert.equal(r.status, 201, `reservar ${pistaId} el ${inicio} para ${socioId}: ${r.texto}`);
  return r.cuerpo.reserva;
}

async function cancelar(api: Api, reserva: { id: string }, cuerpo: Record<string, unknown> = {}) {
  const r = await api.pedir("POST", `/api/reservas/${reserva.id}/cancelar`, { cuerpo });
  assert.equal(r.status, 200, `cancelar ${reserva.id}: ${r.texto}`);
}

/** Socios con la cuota al día y sin rol de gestor, por id. */
async function sociosActivos(api: Api): Promise<string[]> {
  return (await estadoDe(api)).socios.filter((s) => s.cuotaActiva === true && s.rol === "socio").map((s) => s.id).sort(comparar);
}

/** Genera un mes como gestor. Aquí da igual si responde 201 o 200: eso es de C7. */
async function facturasDe(api: Api, mes: string): Promise<any[]> {
  const r = await api.pedir("POST", "/api/facturas", { cuerpo: { mes }, socio: GESTOR });
  assert.ok(r.status === 201 || r.status === 200, `generar ${mes}: esperaba 201 o 200 y llegó ${r.status}: ${r.texto.slice(0, 300)}`);
  assert.ok(Array.isArray(r.cuerpo?.facturas), `generar ${mes} debe responder { facturas }: ${r.texto.slice(0, 300)}`);
  return r.cuerpo.facturas;
}

/** Prepara el escenario y devuelve los meses que hay que generar, con el reloj ya en un momento en que están cerrados. */
type Preparar = (api: Api) => Promise<string[]>;

const ESCENARIOS: Record<string, Preparar> = {
  /** El historial de la semilla: confirmadas, no presentadas y canceladas sin penalización, también de socios sin cuota y del gestor. */
  "octubre de 2026": async () => ["2026-10"],

  /** El historial de noviembre y sus reservas futuras, más penalizaciones y cancelaciones gratuitas hechas con la API. */
  "noviembre de 2026": async (api) => {
    const estado = await estadoDe(api); // 18 de noviembre de 2026 a las 10:00
    const porInicio = (a: Reserva, b: Reserva) => comparar(a.inicio, b.inicio) || comparar(a.id, b.id);
    const confirmadas = estado.reservas.filter((r) => r.estado === "confirmada" && r.inicio > estado.ahora).sort(porInicio);
    // Dos reservas de la semilla que empiezan en menos de 24 horas: se cancelan con forzar y penalización.
    const proximas = confirmadas.filter((r) => r.inicio < "2026-11-19T10:00").slice(0, 2);
    assert.equal(proximas.length, 2, "la semilla trae reservas en las próximas 24 horas");
    for (const r of proximas) await cancelar(api, r, { forzar: true });
    // Dos que empiezan dentro de más de 24 horas: se cancelan gratis y no se facturan.
    for (const r of confirmadas.filter((r) => r.inicio >= "2026-11-20T10:00").slice(0, 2)) await cancelar(api, r);
    // Una socia sin reservas reserva hoy y cancela con penalización: lo único que tiene que facturar es la penalización.
    const sinReservas = estado.socios.find((s) => s.cuotaActiva === true && s.rol === "socio" && !estado.reservas.some((r) => r.socioId === s.id));
    assert.ok(sinReservas, "la semilla trae una socia sin reservas");
    const operativas = estado.pistas.filter((p) => p.estado === "operativa").map((p) => p.id);
    const libre = HORAS.map((h) => `2026-11-18T${h}`).filter((inicio) => inicio > estado.ahora)
      .flatMap((inicio) => operativas.map((pistaId) => ({ pistaId, inicio })))
      .find((f) => !estado.reservas.some((r) => r.pistaId === f.pistaId && r.inicio === f.inicio && r.estado === "confirmada"));
    assert.ok(libre, "queda alguna franja libre hoy");
    await cancelar(api, await reservar(api, sinReservas.id, libre.pistaId, libre.inicio), { forzar: true });
    await reloj(api, "2026-12-02T10:00");
    return ["2026-11"];
  },

  /** Meses preparados a mano, sin nada de la semilla. */
  "enero a marzo de 2027": async (api) => {
    await reloj(api, "2027-01-25T10:00");
    const activos = await sociosActivos(api);
    const [g, a, c, b, e, d, f, p] = [0, 2, 6, 10, 15, 20, 25, 30].map((i) => activos[i]!);
    // La primera reserva de febrero es del socio con el id más alto: el orden de las facturas no puede salir del de las reservas.
    await reservar(api, p, "pista-3", "2027-02-01T09:00");
    // A reserva en otro orden que el de los inicios: sus líneas no pueden salir del orden de creación ni del id de la reserva.
    await reservar(api, a, "pista-2", "2027-02-20T10:30");
    await reservar(api, a, "pista-1", "2027-02-03T18:00");
    await reservar(api, a, "pista-3", "2027-02-10T12:00");
    // B solo tiene una reserva cancelada a tiempo: no se le factura nada.
    await cancelar(api, await reservar(api, b, "pista-1", "2027-02-12T10:30"));
    // C solo tendrá una penalización.
    const deC = await reservar(api, c, "pista-3", "2027-02-05T21:00");
    // D: dos reservas el sábado 6 (una acabará con penalización) y otra el lunes 8 que cancelará gratis.
    await reservar(api, d, "pista-1", "2027-02-06T09:00");
    const penalizadaD = await reservar(api, d, "pista-1", "2027-02-06T10:30");
    const gratisD = await reservar(api, d, "pista-2", "2027-02-08T09:00");
    // E: la última franja de enero, la última de febrero y la primera de marzo.
    await reservar(api, e, "pista-1", "2027-01-31T21:00");
    await reservar(api, e, "pista-2", "2027-02-28T21:00");
    await reservar(api, e, "pista-3", "2027-03-01T09:00");
    // F: dos pistas a la misma hora, 18,00 € cada una. La base del total (2975) no es la suma de las bases (1488 + 1488).
    await reservar(api, f, "pista-1", "2027-02-17T12:00");
    await reservar(api, f, "pista-2", "2027-02-17T12:00");
    // G: una sola reserva de 18,00 €: base 1488 (hacia abajo saldría 1487).
    await reservar(api, g, "pista-1", "2027-02-24T13:30");

    await reloj(api, "2027-02-05T12:00");
    await cancelar(api, deC, { forzar: true }); // faltan 9 horas
    await cancelar(api, penalizadaD, { forzar: true }); // faltan 22,5 horas
    await cancelar(api, gratisD); // faltan 69 horas: gratis
    // A ya ha jugado la del día 3, así que puede reservar otra: la cancela con penalización.
    await cancelar(api, await reservar(api, a, "pista-2", "2027-02-06T09:00"), { forzar: true });

    await reloj(api, "2027-04-02T10:00");
    return ["2027-01", "2027-02", "2027-03"];
  },
};

interface Resultado {
  reservas: Reserva[];
  meses: string[];
  /** Lo que responde generar cada mes. */
  facturas: Map<string, any[]>;
  /** Lo que responde GET /api/facturas?mes= de cada mes, recién generado. */
  consultas: Map<string, { status: number; cuerpo: any }>;
}

/** Cada escenario se prepara y se genera una vez por zona horaria, con su propia API; los tests solo leen el resultado. */
const resultados = new Map<string, Promise<Resultado>>();

function resultado(nombre: string, TZ: string): Promise<Resultado> {
  const clave = `${nombre}|${TZ}`;
  if (!resultados.has(clave)) {
    const promesa = (async () => {
      const api = await arrancarApi({ TZ });
      try {
        const meses = await ESCENARIOS[nombre]!(api);
        const { reservas } = await estadoDe(api);
        const facturas = new Map<string, any[]>();
        const consultas = new Map<string, { status: number; cuerpo: any }>();
        for (const mes of meses) {
          facturas.set(mes, await facturasDe(api, mes));
          const { status, cuerpo } = await api.pedir("GET", `/api/facturas?mes=${mes}`, { socio: GESTOR });
          consultas.set(mes, { status, cuerpo });
        }
        return { reservas, meses, facturas, consultas };
      } finally {
        api.cerrar();
      }
    })();
    promesa.catch(() => {}); // el error lo ve cada test que lo espera
    resultados.set(clave, promesa);
  }
  return resultados.get(clave)!;
}

for (const nombre of Object.keys(ESCENARIOS)) {
  for (const TZ of ZONAS) {
    test(`C3 · ${nombre} (TZ=${TZ}): una factura por cada socio con algo que facturar, ninguna para los demás, ordenadas por id de socio`, OPCIONES, async () => {
      const { reservas, meses, facturas, consultas } = await resultado(nombre, TZ);
      for (const mes of meses) {
        const lista = facturas.get(mes)!;
        const socios = [...esperadas(reservas, mes).keys()].sort(comparar);
        assert.deepEqual(lista.map((f) => f?.socioId), socios, `${mes}: los socios de las facturas, en su orden`);
        for (const f of lista) assert.equal(f?.mes, mes, `${mes}: el mes de la factura de ${f?.socioId}`);
        // Consultadas también van por id de socio. Si GET no responde la lista, eso es de C8.
        const consulta = consultas.get(mes)!;
        if (consulta.status === 200 && Array.isArray(consulta.cuerpo?.facturas)) {
          const ids = consulta.cuerpo.facturas.map((f: any) => String(f?.socioId));
          assert.ok(ids.every((x: string, i: number) => i === 0 || ids[i - 1] <= x), `${mes}: GET /api/facturas?mes= por id de socio: ${ids.join(", ")}`);
        }
      }
    });

    test(`C4 · ${nombre} (TZ=${TZ}): una línea por reserva facturable, con su reservaId, concepto e importe, ordenadas por el inicio`, OPCIONES, async () => {
      const { reservas, meses, facturas } = await resultado(nombre, TZ);
      const inicioDe = new Map(reservas.map((r) => [r.id, r.inicio]));
      // Qué socios tienen factura es de C3: aquí basta con que haya alguna que mirar.
      assert.ok(meses.some((mes) => facturas.get(mes)!.length > 0), `${meses.join(", ")}: hay reservas que facturar y no ha salido ninguna factura`);
      for (const mes of meses) {
        const lista = facturas.get(mes)!;
        const porSocio = esperadas(reservas, mes);
        for (const f of lista) {
          const contexto = `${mes}, factura de ${f?.socioId}`;
          assert.ok(Array.isArray(f?.lineas), `${contexto}: no tiene lineas`);
          const lineas: Linea[] = f.lineas.map((l: any) => ({ reservaId: l?.reservaId, concepto: normalizar(l?.concepto), importe: l?.importe }));
          assert.deepEqual(porReserva(lineas), porReserva(porSocio.get(f.socioId) ?? []), `${contexto}: sus líneas`);
          // Dos reservas del mismo socio a la misma hora pueden ir en cualquier orden.
          const inicios = lineas.map((l) => inicioDe.get(l.reservaId)!);
          assert.ok(inicios.every((x, i) => i === 0 || inicios[i - 1]! <= x), `${contexto}: las líneas van por el inicio de su reserva: ${inicios.join(", ")}`);
        }
      }
    });

    test(`C5 · ${nombre} (TZ=${TZ}): total es la suma de las líneas, base es total / 1,21 redondeado al céntimo sobre el total e iva es total - base`, OPCIONES, async () => {
      const { meses, facturas } = await resultado(nombre, TZ);
      assert.ok(meses.some((mes) => facturas.get(mes)!.length > 0), `${meses.join(", ")}: hay reservas que facturar y no ha salido ninguna factura`);
      for (const mes of meses) {
        const lista = facturas.get(mes)!;
        for (const f of lista) {
          const contexto = `${mes}, factura de ${f?.socioId}`;
          assert.ok(Array.isArray(f?.lineas), `${contexto}: no tiene lineas`);
          const suma = f.lineas.reduce((s: number, l: any) => s + l?.importe, 0);
          assert.equal(f.total, suma, `${contexto}: total`);
          assert.equal(f.base, baseEsperada(suma), `${contexto}: base de un total de ${suma}`);
          assert.equal(f.iva, suma - baseEsperada(suma), `${contexto}: iva de un total de ${suma}`);
        }
      }
    });
  }
}
