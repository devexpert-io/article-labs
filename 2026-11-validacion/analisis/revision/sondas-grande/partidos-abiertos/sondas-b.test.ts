// Sondas de la revisión a mano de partidos-abiertos: no afirman nada, imprimen lo que responde cada estado.
import { after, test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

const ENERO = "2027-01-04T10:00";
const abiertas = new Set<Api>();
after(() => abiertas.forEach((api) => api.cerrar()));

function sonda(nombre: string, cuerpo: (api: Api) => Promise<void>) {
  test(nombre, { timeout: 30_000 }, async () => {
    const api = await arrancarApi({ AHORA: ENERO, TZ: "UTC" });
    abiertas.add(api);
    try {
      await cuerpo(api);
    } catch (e) {
      console.log(`SONDA ${nombre} ERROR ${(e as Error).message.slice(0, 160)}`);
    } finally {
      api.cerrar();
      abiertas.delete(api);
    }
  });
}

const breve = (r: Respuesta) => `${r.status} ${r.cuerpo?.error?.codigo ?? ""}`.trim();
const log = (etiqueta: string, valor: unknown) => console.log(`SONDA ${etiqueta} => ${typeof valor === "string" ? valor : JSON.stringify(valor)}`);
const partidoDe = (r: Respuesta) => r.cuerpo?.partido ?? r.cuerpo;
const ruta = (p: any) => `/api/partidos/${encodeURIComponent(String(p.id))}`;

async function reloj(api: Api, ahora: string) {
  const r = await api.pedir("POST", "/_reloj", { cuerpo: { ahora } });
  if (r.status !== 200) throw new Error(`reloj ${ahora}: ${r.texto}`);
}

async function crear(api: Api, socio: string, cuerpo: Record<string, unknown>) {
  const r = await api.pedir("POST", "/api/partidos", { cuerpo, socio });
  if (r.status < 200 || r.status >= 300) throw new Error(`crear ${JSON.stringify(cuerpo)}: ${r.texto}`);
  return partidoDe(r);
}

async function unir(api: Api, p: any, ...socios: string[]) {
  for (const s of socios) {
    const r = await api.pedir("POST", `${ruta(p)}/unirse`, { socio: s });
    if (r.status < 200 || r.status >= 300) throw new Error(`unir ${s}: ${r.texto}`);
  }
}

async function ver(api: Api, p: any) {
  return partidoDe(await api.pedir("GET", ruta(p)));
}

const S = ["socio-001", "socio-002", "socio-003", "socio-004", "socio-005", "socio-006", "socio-007", "socio-008"];

sonda("P8 nivel inválido de otro socio", async (api) => {
  log("P8 PATCH socio-002 nivel 9 como socio-001", breve(await api.pedir("PATCH", "/api/socios/socio-002", { cuerpo: { nivel: 9 }, socio: "socio-001" })));
  log("P8 PATCH socio-002 nivel 4 como socio-001", breve(await api.pedir("PATCH", "/api/socios/socio-002", { cuerpo: { nivel: 4 }, socio: "socio-001" })));
});

sonda("P9 disponibilidad con fecha imposible", async (api) => {
  for (const f of ["2027-02-30", "2027-13-45", "2027-01-06", "hoy"]) {
    const r = await api.pedir("GET", `/api/disponibilidad?fecha=${f}`);
    log(`P9 GET /api/disponibilidad?fecha=${f}`, `${breve(r)} pistas=${(r.cuerpo?.pistas ?? []).length}`);
  }
  const r = await api.pedir("GET", "/api/reservas?fecha=2027-02-30");
  log("P9 GET /api/reservas?fecha=2027-02-30", breve(r));
});

sonda("P10 nivel sin X-Socio", async (api) => {
  log("P10 PATCH socio-002 sin X-Socio", breve(await api.pedir("PATCH", "/api/socios/socio-002", { cuerpo: { nivel: 4 } })));
});

sonda("P11 límite: el organizador cuenta una vez", async (api) => {
  const [a, b] = S;
  await crear(api, a, { pistaId: "pista-1", inicio: "2027-01-06T10:30" });
  await crear(api, a, { pistaId: "pista-1", inicio: "2027-01-07T10:30" });
  log("P11a dos partidos organizados, reservar 3ª", breve(await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: a, pistaId: "pista-1", inicio: "2027-01-08T10:30" }, socio: a })));
  log("P11a y la 4ª", breve(await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: a, pistaId: "pista-1", inicio: "2027-01-09T10:30" }, socio: a })));
  // b se une a un partido de otro, organiza uno y luego reserva
  const p = await crear(api, "socio-003", { pistaId: "pista-2", inicio: "2027-01-06T10:30" });
  await unir(api, p, b);
  const q = await crear(api, b, { pistaId: "pista-2", inicio: "2027-01-07T10:30" });
  await unir(api, q, "socio-004");
  log("P11b se une a 1 y organiza 1 (con un jugador), reservar 3ª", breve(await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: b, pistaId: "pista-2", inicio: "2027-01-08T10:30" }, socio: b })));
  log("P11b y la 4ª", breve(await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: b, pistaId: "pista-2", inicio: "2027-01-09T10:30" }, socio: b })));
  // socio-004 juega en el de b y organiza dos
  await crear(api, "socio-004", { pistaId: "pista-3", inicio: "2027-01-06T10:30" });
  log("P11c juega en 1 y organiza 1, crear 3º", breve(await api.pedir("POST", "/api/partidos", { cuerpo: { pistaId: "pista-3", inicio: "2027-01-07T10:30" }, socio: "socio-004" })));
  log("P11c y el 4º", breve(await api.pedir("POST", "/api/partidos", { cuerpo: { pistaId: "pista-3", inicio: "2027-01-08T10:30" }, socio: "socio-004" })));
});

sonda("P12 salir de un completo a 6 horas o menos", async (api) => {
  const p = await crear(api, "socio-001", { pistaId: "pista-1", inicio: "2027-01-06T12:00" });
  await unir(api, p, "socio-002", "socio-003", "socio-004");
  await reloj(api, "2027-01-06T06:00");
  const r = await api.pedir("POST", `${ruta(p)}/salir`, { cuerpo: { forzar: true }, socio: "socio-002" });
  const x = await ver(api, p);
  log("P12 salir a 6 h", `${breve(r)} estado=${x.estado} motivo=${x.motivo} pen=${JSON.stringify(x.penalizaciones)}`);
});

sonda("P13 salir tarde y luego se cancela solo", async (api) => {
  const p = await crear(api, "socio-001", { pistaId: "pista-1", inicio: "2027-01-06T12:00" });
  await unir(api, p, "socio-002");
  await reloj(api, "2027-01-05T12:01");
  const r = await api.pedir("POST", `${ruta(p)}/salir`, { cuerpo: { forzar: true }, socio: "socio-002" });
  log("P13 salir a 23:59", `${breve(r)} pen=${JSON.stringify((await ver(api, p)).penalizaciones)}`);
  await reloj(api, "2027-01-06T06:00");
  const x = await ver(api, p);
  log("P13 a 6 h", `estado=${x.estado} motivo=${x.motivo} pen=${JSON.stringify(x.penalizaciones)}`);
});

sonda("P14 crear un partido sin inicio o con inicio raro", async (api) => {
  for (const cuerpo of [{ pistaId: "pista-1" }, { pistaId: "pista-1", inicio: 123 }, { inicio: "2027-01-06T10:30" }, { pistaId: "pista-1", inicio: "mañana" }, { pistaId: "pista-1", inicio: "2027-01-06T10:31" }]) {
    const r = await api.pedir("POST", "/api/partidos", { cuerpo, socio: "socio-001" });
    const r2 = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-001", ...cuerpo }, socio: "socio-001" });
    log(`P14 ${JSON.stringify(cuerpo)}`, `partidos=${breve(r)} reservas=${breve(r2)}`);
  }
});
