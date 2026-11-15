// Tests ampliados de la spec `partidos-abiertos`: los defectos de comportamiento que confirmó la revisión a mano de las falsas
// alarmas, para probarlos en todos los estados del encargo.
// Caja negra: solo la API HTTP, más /_estado para preparar. Cada prueba arranca su propia API, con el reloj del club en el
// lunes 4 de enero de 2027 y en UTC (en enero y febrero no hay cambios de hora).
// X1 es del filtro fecha de GET /api/partidos (C19): la spec pide 400 DATOS_INVALIDOS "con una fecha que no vale", y una fecha
// con la forma AAAA-MM-DD que no existe en el calendario no vale. El filtro es nuevo, así que no hay comportamiento de la base
// que conservar. Las fechas que sí existen, también el 29 de febrero de un año bisiesto, tienen que seguir valiendo.
// X2 es de "lo demás no cambia" (C20): lo esperado es lo que hace la base, que en GET /api/disponibilidad solo mira la forma
// AAAA-MM-DD y responde 200 con las franjas de ese día aunque la fecha no exista. Pasa también contra la base.
// X3 es de crear con las reglas de siempre (C3): un inicio que falta, que no es texto o que no es una fecha y hora responde el
// 400 que da POST /api/reservas por ese inicio (DATOS_INVALIDOS o FRANJA_INVALIDA, se aceptan los dos) y no reserva nada. El
// plazo de las 6 horas (409 DEMASIADO_TARDE) es de una franja, y sin una franja válida no se puede calcular.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

/** Lunes 4 de enero de 2027 a las 10:00: nadie tiene reservas futuras y las franjas de las pistas operativas están libres. */
const ENERO = "2027-01-04T10:00";

/** Fechas con la forma AAAA-MM-DD que no existen en el calendario. */
const IMPOSIBLES = [
  "2027-02-30",
  "2027-02-29", // 2027 no es bisiesto
  "2027-04-31",
  "2027-13-01", // mes 13
  "2027-00-10", // mes 0
  "2027-01-32", // día 32
  "2027-01-00", // día 0
];

const abiertas = new Set<Api>();
after(() => abiertas.forEach((api) => api.cerrar()));

function prueba(nombre: string, cuerpo: (api: Api) => Promise<void>) {
  test(nombre, { timeout: 30_000 }, async () => {
    const api = await arrancarApi({ AHORA: ENERO, TZ: "UTC" });
    abiertas.add(api);
    try {
      await cuerpo(api);
    } finally {
      api.cerrar();
      abiertas.delete(api);
    }
  });
}

function esError(r: Respuesta, http: number, codigo: string, contexto = "") {
  assert.equal(r.status, http, `${contexto} esperaba ${http} ${codigo} y llegó ${r.status}: ${r.texto}`);
  assert.equal(r.cuerpo?.error?.codigo, codigo, `${contexto} ${r.texto}`);
}

/** Cuando la spec admite más de un error, vale cualquiera de la lista. */
function esUnoDe(r: Respuesta, posibles: [number, string][], contexto = "") {
  const vale = posibles.some(([http, codigo]) => r.status === http && r.cuerpo?.error?.codigo === codigo);
  const esperados = posibles.map(([http, codigo]) => `${http} ${codigo}`).join(" o ");
  assert.ok(vale, `${contexto} esperaba ${esperados} y llegó ${r.status}: ${r.texto}`);
}

const salioBien = (r: Respuesta) => r.status >= 200 && r.status < 300;

/** Socios de la semilla con rol socio y la cuota al día. En 2027 ninguno tiene reservas futuras. */
async function sociosAlDia(api: Api, cuantos: number): Promise<string[]> {
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  const ids: string[] = estado.socios.filter((s: any) => s.rol === "socio" && s.cuotaActiva === true).map((s: any) => s.id);
  assert.ok(ids.length >= cuantos, `hacen falta ${cuantos} socios con la cuota al día y hay ${ids.length}`);
  return ids.slice(0, cuantos);
}

/** Crea un partido y devuelve el de la respuesta. */
async function crearPartido(api: Api, organizador: string, cuerpo: Record<string, unknown>): Promise<any> {
  const r = await api.pedir("POST", "/api/partidos", { cuerpo, socio: organizador });
  assert.ok(salioBien(r), `crear el partido ${JSON.stringify(cuerpo)} como ${organizador}: ${r.status} ${r.texto}`);
  const partido = r.cuerpo?.partido ?? r.cuerpo;
  assert.ok(partido?.id !== undefined && partido?.id !== null && partido?.id !== "", `el partido creado no trae id: ${r.texto}`);
  return partido;
}

/** La lista de GET /api/partidos con esa consulta. */
async function partidosConPlazas(api: Api, consulta: string): Promise<any[]> {
  const r = await api.pedir("GET", `/api/partidos${consulta}`);
  assert.equal(r.status, 200, `GET /api/partidos${consulta}: ${r.texto}`);
  const lista = Array.isArray(r.cuerpo) ? r.cuerpo : r.cuerpo?.partidos;
  assert.ok(Array.isArray(lista), `GET /api/partidos${consulta} no trae la lista de partidos: ${r.texto}`);
  return lista;
}

/** Cuántas reservas hay en el club, para comprobar que no se ha creado ninguna. */
async function totalReservas(api: Api): Promise<number> {
  const r = await api.pedir("GET", "/api/reservas?limite=1");
  assert.equal(r.status, 200, r.texto);
  return r.cuerpo.total;
}

prueba("X1 · GET /api/partidos con una fecha que no existe en el calendario responde 400 DATOS_INVALIDOS, y con una que existe filtra (C19)", async (api) => {
  const [organizador] = await sociosAlDia(api, 1);
  const partido = await crearPartido(api, organizador, { pistaId: "pista-1", inicio: "2027-01-06T10:30" });
  for (const fecha of IMPOSIBLES) {
    esError(await api.pedir("GET", `/api/partidos?fecha=${fecha}`), 400, "DATOS_INVALIDOS", `fecha=${fecha}:`);
  }
  const delDia = await partidosConPlazas(api, "?fecha=2027-01-06");
  assert.deepEqual(delDia.map((p) => String(p.id)), [String(partido.id)], "fecha=2027-01-06 trae el partido de ese día");
  assert.deepEqual(await partidosConPlazas(api, "?fecha=2028-02-29"), [], "fecha=2028-02-29 existe (2028 es bisiesto) y no tiene partidos");
});

prueba("X2 · GET /api/disponibilidad responde como en la base a una fecha con la forma AAAA-MM-DD aunque no exista: 200 con las franjas de ese día (C20)", async (api) => {
  for (const fecha of ["2027-02-30", "2027-13-01"]) {
    const r = await api.pedir("GET", `/api/disponibilidad?fecha=${fecha}`);
    assert.equal(r.status, 200, `disponibilidad del ${fecha}, que la base responde con 200: ${r.texto}`);
    assert.equal(r.cuerpo?.pistas?.length, 4, `las 4 pistas del club el ${fecha}: ${r.texto}`);
    const pista1 = r.cuerpo.pistas.find((p: any) => p.pistaId === "pista-1");
    assert.ok(pista1, `está la pista 1 el ${fecha}: ${r.texto}`);
    assert.equal(pista1.franjas.length, 9, `las 9 franjas de la pista 1 el ${fecha}: ${r.texto}`);
    assert.equal(pista1.franjas[0].inicio, `${fecha}T09:00`, `la primera franja del ${fecha} empieza a las 09:00: ${r.texto}`);
    assert.equal(pista1.franjas[0].estado, "libre", `la primera franja del ${fecha} está libre: ${r.texto}`);
  }
});

prueba("X3 · crear un partido sin inicio, o con un inicio que no es una fecha y hora, responde el 400 de reservar y no reserva nada (C3)", async (api) => {
  const [organizador] = await sociosAlDia(api, 1);
  const antes = await totalReservas(api);
  const casos: Record<string, unknown>[] = [
    { pistaId: "pista-1" },
    { pistaId: "pista-1", inicio: 123 },
    { pistaId: "pista-1", inicio: "mañana" },
    { pistaId: "pista-1", inicio: "2027-01-06" },
    { pistaId: "pista-1", inicio: "06/01/2027 10:30" },
  ];
  for (const cuerpo of casos) {
    const r = await api.pedir("POST", "/api/partidos", { cuerpo, socio: organizador });
    esUnoDe(r, [[400, "DATOS_INVALIDOS"], [400, "FRANJA_INVALIDA"]], `${JSON.stringify(cuerpo)}:`);
  }
  assert.equal(await totalReservas(api), antes, "no se ha reservado nada");
});
