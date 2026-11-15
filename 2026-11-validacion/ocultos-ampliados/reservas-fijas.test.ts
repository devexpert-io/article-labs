// Tests ampliados de la spec `reservas-fijas`: los defectos de comportamiento que confirmó la revisión a mano de las falsas
// alarmas, para probarlos en todos los estados del encargo.
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. Cada prueba arranca su propia API, con el
// reloj del club en el lunes 4 de enero de 2027 y en UTC, salvo X4, que arranca una con TZ=UTC y otra con TZ=Europe/Madrid,
// las dos con el reloj en el 1 de marzo de 2027.
// La base acepta en POST /api/reservas fechas bien formadas que no existen (2027-02-30T10:30 responde 201 y guarda la fecha
// tal cual). Para una serie, la spec pide 400 FRANJA_INVALIDA si inicio no es una franja válida, y aceptar la fecha como hace
// la base tampoco la contradice: estos tests admiten las dos respuestas y solo exigen que no haya un 500, que si se rechaza
// no se cree nada y que, si la serie se crea, inicio sea su primera reserva. X2 solo mira las series que se crean, así que
// pasa también donde no se crea ninguna.
// Todas las fechas son posteriores al reloj también como texto, para que FRANJA_PASADA no entre en juego, y cada caso usa
// su propio socio y su propia hora, para que dos casos no compitan por la misma franja aunque una implementación normalice
// las fechas.
// X3 y X4 son de "lo demás no cambia" (C12): lo esperado es lo que hace la base, así que pasan también contra ella. X4 cancela
// reservas normales cuando entre medias cambia la hora: la base cuenta las 24 horas como horas de reloj (trata la hora local
// como UTC), y eso es lo que se mantiene, con TZ=UTC y con TZ=Europe/Madrid.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

const GESTOR = "socio-040";
/** Lunes 4 de enero de 2027 a las 10:00: nadie tiene reservas futuras y las franjas de las pistas operativas están libres. */
const ENERO = "2027-01-04T10:00";

/** Fechas con el formato AAAA-MM-DDTHH:MM y una hora de franja que no existen en el calendario. */
const IMPOSIBLES = [
  "2027-13-01T09:00", // mes 13
  "2027-12-32T10:30", // día 32
  "2027-02-00T12:00", // día 0
  "2028-00-10T13:30", // mes 0
  "2027-02-29T15:00", // 2027 no es bisiesto
  "2027-02-30T16:30",
  "2027-04-31T18:00",
];

const abiertas = new Set<Api>();
after(() => abiertas.forEach((api) => api.cerrar()));

function prueba(nombre: string, cuerpo: (api: Api) => Promise<void>, entorno: Record<string, string> = {}) {
  test(nombre, { timeout: 30_000 }, async () => {
    const api = await arrancarApi({ AHORA: ENERO, TZ: "UTC", ...entorno });
    abiertas.add(api);
    try {
      await cuerpo(api);
    } finally {
      api.cerrar();
      abiertas.delete(api);
    }
  });
}

const ok = (r: Respuesta) => r.status >= 200 && r.status < 300;

/** Socios de la semilla con rol socio y la cuota al día (en 2027 ninguno tiene reservas futuras). */
async function sociosAlDia(api: Api, cuantos: number): Promise<string[]> {
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  const ids: string[] = estado.socios.filter((s: any) => s.rol === "socio" && s.cuotaActiva === true).map((s: any) => s.id);
  assert.ok(ids.length >= cuantos, `hacen falta ${cuantos} socios con la cuota al día y hay ${ids.length}`);
  return ids.slice(0, cuantos);
}

/** Pide crear una serie como el gestor. */
function pedirSerie(api: Api, cuerpo: Record<string, unknown>) {
  return api.pedir("POST", "/api/series", { cuerpo, socio: GESTOR });
}

/** Las reservas de un socio desde el 1 de enero de 2027, por orden de inicio. */
async function reservasDe(api: Api, socioId: string): Promise<any[]> {
  const r = await api.pedir("GET", `/api/reservas?socio=${socioId}&desde=2027-01-01&limite=100`);
  assert.equal(r.status, 200, `GET /api/reservas del socio ${socioId}: ${r.texto}`);
  return [...r.cuerpo.reservas].sort((a: any, b: any) => a.inicio.localeCompare(b.inicio));
}

async function reloj(api: Api, ahora: string) {
  const r = await api.pedir("POST", "/_reloj", { cuerpo: { ahora } });
  assert.equal(r.status, 200, `mover el reloj a ${ahora}: ${r.texto}`);
}

/** Una reserva normal, para preparar. */
async function reservar(api: Api, socioId: string, pistaId: string, inicio: string): Promise<any> {
  const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio } });
  assert.ok(r.status >= 200 && r.status < 300 && r.cuerpo?.reserva, `reservar ${pistaId} ${inicio} para ${socioId}: ${r.status} ${r.texto}`);
  return r.cuerpo.reserva;
}

/** Cuántas reservas hay en el club, para comprobar que no se ha creado ninguna. */
async function totalReservas(api: Api): Promise<number> {
  const r = await api.pedir("GET", "/api/reservas?limite=1");
  assert.equal(r.status, 200, r.texto);
  return r.cuerpo.total;
}

// ---- Tests ----

prueba("X1 · una serie con una fecha que no existe se crea o se rechaza con 400 FRANJA_INVALIDA sin crear nada, nunca con un 500 (C2)", async (api) => {
  const socios = await sociosAlDia(api, IMPOSIBLES.length);
  const fallos: string[] = [];
  for (const [i, inicio] of IMPOSIBLES.entries()) {
    const antes = await totalReservas(api);
    const r = await pedirSerie(api, { socioId: socios[i], pistaId: "pista-1", inicio, semanas: 2 });
    if (ok(r)) continue; // aceptarla, como acepta la base esas fechas en las reservas normales, también vale (X2 mira cómo queda)
    if (r.status !== 400 || r.cuerpo?.error?.codigo !== "FRANJA_INVALIDA") {
      fallos.push(`inicio = ${inicio}: ${r.status} ${r.texto.slice(0, 160)}`);
    } else if ((await totalReservas(api)) !== antes) {
      fallos.push(`inicio = ${inicio}: responde 400 FRANJA_INVALIDA pero crea reservas`);
    }
  }
  assert.deepEqual(fallos, [], "cada fecha que no existe da 2xx o 400 FRANJA_INVALIDA");
});

prueba("X2 · si una serie con una fecha que no existe se crea, su primera reserva empieza en inicio (C2)", async (api) => {
  const socios = await sociosAlDia(api, IMPOSIBLES.length);
  const fallos: string[] = [];
  for (const [i, inicio] of IMPOSIBLES.entries()) {
    const r = await pedirSerie(api, { socioId: socios[i]!, pistaId: "pista-1", inicio, semanas: 2 });
    if (!ok(r)) continue; // rechazarla también vale (X1 mira cómo)
    const suyas = await reservasDe(api, socios[i]!);
    if (suyas[0]?.inicio !== inicio) {
      const serie = r.cuerpo?.serie ?? r.cuerpo;
      fallos.push(`inicio = ${inicio}: serie.inicio = ${serie?.inicio} y reservas en ${JSON.stringify(suyas.map((x) => x.inicio))}`);
    }
  }
  assert.deepEqual(fallos, [], "inicio es la primera reserva de la serie");
});

prueba("X3 · una reserva normal con una fecha que no existe se sigue creando como en la base, con 201 y ese inicio (C12)", async (api) => {
  const socios = await sociosAlDia(api, IMPOSIBLES.length);
  const fallos: string[] = [];
  for (const [i, inicio] of IMPOSIBLES.entries()) {
    const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: socios[i], pistaId: "pista-2", inicio } });
    if (r.status !== 201 || r.cuerpo?.reserva?.inicio !== inicio) fallos.push(`inicio = ${inicio}: ${r.status} ${r.texto.slice(0, 160)}`);
  }
  assert.deepEqual(fallos, [], "las reservas normales responden igual que en la base");
});

test("X4 · cancelar una reserva normal funciona igual que antes cuando entre medias cambia la hora: el plazo de 24 horas se cuenta como en la base (C12)", { timeout: 60_000 }, async () => {
  const fallos: string[] = [];
  for (const TZ of ["UTC", "Europe/Madrid"]) {
    const api = await arrancarApi({ AHORA: "2027-03-01T10:00", TZ });
    abiertas.add(api);
    try {
      const [a, b] = await sociosAlDia(api, 2);
      const marzo = await reservar(api, a!, "pista-2", "2027-03-28T10:30"); // el domingo 28 de marzo de 2027 se adelanta la hora
      const octubre = await reservar(api, b!, "pista-2", "2027-10-31T10:30"); // el domingo 31 de octubre de 2027 se atrasa
      await reloj(api, "2027-03-27T10:30"); // 24 horas de reloj antes (23 reales): en la base se cancela gratis
      const r1 = await api.pedir("POST", `/api/reservas/${marzo.id}/cancelar`, { cuerpo: {} });
      if (r1.status !== 200 || r1.cuerpo?.reserva?.estado !== "cancelada" || (r1.cuerpo?.reserva?.penalizacion ?? 0) !== 0) {
        fallos.push(`TZ=${TZ}, reserva del 2027-03-28T10:30 con el reloj en 2027-03-27T10:30: ${r1.status} ${r1.texto.slice(0, 160)}`);
      }
      await reloj(api, "2027-10-30T11:00"); // 23,5 horas de reloj antes (24,5 reales): en la base, FUERA_DE_PLAZO sin forzar
      const r2 = await api.pedir("POST", `/api/reservas/${octubre.id}/cancelar`, { cuerpo: {} });
      if (r2.status !== 409 || r2.cuerpo?.error?.codigo !== "FUERA_DE_PLAZO") {
        fallos.push(`TZ=${TZ}, reserva del 2027-10-31T10:30 con el reloj en 2027-10-30T11:00: ${r2.status} ${r2.texto.slice(0, 160)}`);
      }
    } finally {
      api.cerrar();
      abiertas.delete(api);
    }
  }
  assert.deepEqual(fallos, [], "cancelar una reserva normal responde igual que en la base");
});
