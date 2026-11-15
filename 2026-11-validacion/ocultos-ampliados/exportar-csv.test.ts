// Tests ampliados de la spec `exportar-csv`: un test por clase de defecto de comportamiento confirmado en la revisión a
// mano de las falsas alarmas, para probarlo en todos los estados del encargo. Caja negra: la API HTTP, con /_estado para
// elegir socios. Cada prueba arranca su propia API, con el reloj fijado y la hora de Madrid (la del club), como los ocultos.
//
// X1 · fechas que no existen en desde o hasta (haiku-r2 responde 500 con 2027-13-01, 2027-00-10 o 2027-02-00).
// X2 · notas que empiezan por =, +, - o @ (la reparación a19f726 de deepseek-r2 les pone un apóstrofo delante).
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

const GESTOR = "socio-040";
/** Si la API se cuelga, el test falla a los 30 segundos y la API se cierra. */
const OPCIONES = { timeout: 30_000 };
/** La hora de la semilla: miércoles 18 de noviembre de 2026 a las 10:00. Diciembre está libre. */
const AHORA = "2026-11-18T10:00";

/** Arranca una API solo para este test, con la hora de Madrid (la del club), y la cierra al terminar. */
async function conApi(t: TestContext, prueba: (api: Api) => Promise<void>): Promise<void> {
  const api = await arrancarApi({ TZ: "Europe/Madrid", AHORA });
  t.signal.addEventListener("abort", () => api.cerrar(), { once: true });
  try {
    await prueba(api);
  } finally {
    api.cerrar();
  }
}

function exportar(api: Api, consulta: string) {
  return api.pedir("GET", `/api/reservas/exportar?${consulta}`, { socio: GESTOR });
}

// --- Lectura del CSV (la de los tests ocultos de exportar-csv) -------------------------------------------------

interface Campo {
  /** El valor, ya sin las comillas del RFC 4180. */
  valor: string;
  /** El campo tal como viene en el cuerpo. */
  crudo: string;
}

/** Lee un CSV con las reglas del RFC 4180, tolerante con \n y \r sueltos como fin de línea y con comillas mal cerradas. */
function leerCsv(texto: string): Campo[][] {
  const registros: Campo[][] = [];
  if (texto === "") return registros;
  let registro: Campo[] = [];
  let i = 0;
  for (;;) {
    const inicio = i;
    let valor = "";
    if (texto[i] === '"') {
      i++;
      while (i < texto.length) {
        if (texto[i] === '"' && texto[i + 1] === '"') {
          valor += '"';
          i += 2;
        } else if (texto[i] === '"') {
          i++;
          break;
        } else {
          valor += texto[i++];
        }
      }
    }
    while (i < texto.length && texto[i] !== "," && texto[i] !== "\r" && texto[i] !== "\n") valor += texto[i++];
    registro.push({ valor, crudo: texto.slice(inicio, i) });
    if (i >= texto.length) {
      registros.push(registro);
      return registros;
    }
    if (texto[i] === ",") {
      i++;
      continue;
    }
    const salto = texto.startsWith("\r\n", i) ? "\r\n" : texto[i]!;
    registros.push(registro);
    registro = [];
    i += salto.length;
    if (i >= texto.length) return registros;
  }
}

/** Cómo debe ir un campo según la spec: entre comillas si lleva comas, comillas o saltos de línea, y si no, tal cual. */
function escapado(valor: string): string {
  return /[",\r\n]/.test(valor) ? `"${valor.replaceAll('"', '""')}"` : valor;
}

/** Para crear reservas: elige socios con la cuota al día y hueco (como mucho 3 reservas futuras confirmadas). */
async function preparadorDeReservas(api: Api) {
  const e = (await api.pedir("GET", "/_estado")).cuerpo;
  const huecos = new Map<string, number>();
  for (const s of e.socios) {
    if (!s.cuotaActiva) continue;
    const futuras = e.reservas.filter((r: { socioId: string; estado: string; inicio: string }) => r.socioId === s.id && r.estado === "confirmada" && r.inicio > e.ahora).length;
    if (futuras < 3) huecos.set(s.id, 3 - futuras);
  }
  return async (pistaId: string, inicio: string, notas: string): Promise<{ id: string }> => {
    const socioId = [...huecos.keys()].find((id) => huecos.get(id)! > 0);
    assert.ok(socioId, "no queda ningún socio con hueco para reservar");
    huecos.set(socioId, huecos.get(socioId)! - 1);
    const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio, notas } });
    assert.equal(r.status, 201, `no se pudo crear la reserva de ${pistaId} del ${inicio}: ${r.texto}`);
    return r.cuerpo.reserva;
  };
}

// --- Tests ---------------------------------------------------------------------------------------------------

test("X1 · una exportación con una fecha que no existe en desde o hasta responde 400 DATOS_INVALIDOS o 200, nunca 500 (C8)", OPCIONES, (t) => conApi(t, async (api) => {
  // Con la spec valen las dos lecturas de "formato AAAA-MM-DD": rechazar la fecha (400 DATOS_INVALIDOS) o tomarla por su
  // forma y exportar (200). Cada periodo es corto con cualquier lectura, así que el límite de 92 días no entra.
  const periodos = [
    ["2027-13-01", "2027-13-05"],
    ["2027-00-10", "2027-00-12"],
    ["2027-02-00", "2027-02-05"],
    ["2027-12-30", "2027-13-01"],
    ["2027-02-27", "2027-02-30"],
    ["2027-04-31", "2027-05-02"],
    ["0000-00-00", "0000-00-00"],
    ["2027-99-99", "2027-99-99"],
  ];
  const fallos: string[] = [];
  for (const [desde, hasta] of periodos) {
    const r = await exportar(api, `desde=${desde}&hasta=${hasta}`);
    const vale = (r.status >= 200 && r.status < 300) || (r.status === 400 && r.cuerpo?.error?.codigo === "DATOS_INVALIDOS");
    if (!vale) fallos.push(`desde=${desde}&hasta=${hasta}: ${r.status} ${r.texto.slice(0, 160)}`);
  }
  assert.deepEqual(fallos, [], "esperaba 400 DATOS_INVALIDOS o 200");
}));

test("X2 · las notas que empiezan por =, +, - o @ se exportan tal cual, sin nada delante (C6)", OPCIONES, (t) => conApi(t, async (api) => {
  // C6: un campo solo va entre comillas, con las de dentro duplicadas, si lleva comas, comillas o saltos de línea, y el
  // resto va sin comillas. Las notas son las de la reserva: nada en la spec permite cambiarlas para la hoja de cálculo.
  const reservar = await preparadorDeReservas(api);
  const casos = [
    { pistaId: "pista-1", inicio: "2026-12-02T09:00", notas: "=SUMA(A1:A3)" },
    { pistaId: "pista-2", inicio: "2026-12-02T09:00", notas: "+34 600 000 000" },
    { pistaId: "pista-3", inicio: "2026-12-02T09:00", notas: "-Traen bolas nuevas" },
    { pistaId: "pista-1", inicio: "2026-12-02T10:30", notas: "@Ana confirma la pista" },
    { pistaId: "pista-2", inicio: "2026-12-02T10:30", notas: "-Traen palas, bolas y agua" },
    { pistaId: "pista-3", inicio: "2026-12-02T10:30", notas: '=HIPERVINCULO("http://club.example";"web")' },
  ];
  const creadas = [];
  for (const caso of casos) creadas.push({ ...caso, id: (await reservar(caso.pistaId, caso.inicio, caso.notas)).id });
  const r = await exportar(api, "desde=2026-12-01&hasta=2026-12-03");
  assert.ok(r.status >= 200 && r.status < 300, `${r.status} ${r.texto.slice(0, 300)}`);
  const filas = leerCsv(r.texto).slice(1);
  const fallos: string[] = [];
  for (const c of creadas) {
    const fila = filas.find((f) => f[0]!.valor === c.id);
    if (!fila) {
      fallos.push(`${c.id}: no sale su fila`);
      continue;
    }
    const notas = fila[9];
    if (fila.length !== 10 || notas?.valor !== c.notas || notas?.crudo !== escapado(c.notas)) {
      fallos.push(`${c.id} con notas ${JSON.stringify(c.notas)}: ${JSON.stringify(fila.map((f) => f.crudo).join(","))}`);
    }
  }
  assert.deepEqual(fallos, [], "las notas deben salir tal cual, solo con el escapado del RFC 4180");
}));
