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

sonda("P1 reservar sin X-Socio", async (api) => {
  const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-001", pistaId: "pista-1", inicio: "2027-01-06T10:30" } });
  log("P1 POST /api/reservas sin X-Socio", breve(r));
});

sonda("P2 partido inexistente sin X-Socio", async (api) => {
  for (const accion of ["unirse", "salir", "cancelar"]) {
    const r = await api.pedir("POST", `/api/partidos/P-9999/${accion}`, { cuerpo: {} });
    log(`P2 ${accion} P-9999 sin X-Socio`, breve(r));
    const r2 = await api.pedir("POST", `/api/partidos/P-9999/${accion}`, { cuerpo: {}, socio: "socio-001" });
    log(`P2 ${accion} P-9999 con socio-001`, breve(r2));
  }
});

sonda("P3 X-Socio inexistente en consultas", async (api) => {
  log("P3 GET /api/partidos X-Socio socio-999", breve(await api.pedir("GET", "/api/partidos", { socio: "socio-999" })));
  log("P3 GET /api/reservas X-Socio socio-999", breve(await api.pedir("GET", "/api/reservas", { socio: "socio-999" })));
  log("P3 GET /api/pistas X-Socio socio-999", breve(await api.pedir("GET", "/api/pistas", { socio: "socio-999" })));
});

sonda("P4 nivel de un socio que no existe", async (api) => {
  log("P4 PATCH socio-999 como socio-001", breve(await api.pedir("PATCH", "/api/socios/socio-999", { cuerpo: { nivel: 4 }, socio: "socio-001" })));
  log("P4 PATCH socio-999 como gestor", breve(await api.pedir("PATCH", "/api/socios/socio-999", { cuerpo: { nivel: 4 }, socio: "socio-040" })));
});

sonda("P5 filtro de fecha imposible", async (api) => {
  await crear(api, "socio-001", { pistaId: "pista-1", inicio: "2027-01-06T10:30" });
  for (const f of ["2027-02-30", "2027-13-45", "2027-02-29", "2028-02-29", "2027-01-06", "2027-1-6"]) {
    const r = await api.pedir("GET", `/api/partidos?fecha=${f}`);
    log(`P5 GET /api/partidos?fecha=${f}`, `${breve(r)} n=${(r.cuerpo?.partidos ?? []).length}`);
  }
});

sonda("P6 partido abierto que ya ha empezado", async (api) => {
  const p = await crear(api, "socio-001", { pistaId: "pista-1", inicio: "2027-01-06T12:00" });
  await unir(api, p, "socio-002");
  await reloj(api, "2027-01-06T12:30");
  log("P6 estado", (await ver(api, p)).estado);
  log("P6 salir socio-002", breve(await api.pedir("POST", `${ruta(p)}/salir`, { cuerpo: { forzar: true }, socio: "socio-002" })));
  log("P6 cancelar organizador", breve(await api.pedir("POST", `${ruta(p)}/cancelar`, { cuerpo: { forzar: true }, socio: "socio-001" })));
  const q = await crear(api, "socio-003", { pistaId: "pista-2", inicio: "2027-01-07T12:00" });
  await unir(api, q, "socio-004", "socio-005", "socio-006");
  await reloj(api, "2027-01-07T12:30");
  log("P6 completo empezado estado", (await ver(api, q)).estado);
  log("P6 completo empezado salir", breve(await api.pedir("POST", `${ruta(q)}/salir`, { cuerpo: { forzar: true }, socio: "socio-004" })));
  log("P6 completo empezado cancelar", breve(await api.pedir("POST", `${ruta(q)}/cancelar`, { cuerpo: { forzar: true }, socio: "socio-003" })));
});

sonda("P7 filtro de nivel raro", async (api) => {
  await crear(api, "socio-001", { pistaId: "pista-1", inicio: "2027-01-06T10:30" });
  for (const n of ["0x4", "%204", "", "%20", "4%20", "4,5", "4.5", "4e0", "abc", "0"]) {
    const r = await api.pedir("GET", `/api/partidos?nivel=${n}`);
    log(`P7 GET /api/partidos?nivel=${n}`, `${breve(r)} n=${(r.cuerpo?.partidos ?? []).length}`);
  }
});

