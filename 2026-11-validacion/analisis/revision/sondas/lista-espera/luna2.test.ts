// Sonda para los hallazgos de lista-espera-luna-r2 (41faa01, 2ec6fcf, 6840b55, acce177, 9447b2a).
import { test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

const GESTOR = "socio-040";
const A = { pistaId: "pista-1", inicio: "2026-11-19T19:30" }; // ocupada por socio-007 (R-0515)

async function conApi(fn: (api: Api) => Promise<void>) {
  const api = await arrancarApi();
  try {
    await fn(api);
  } finally {
    api.cerrar();
  }
}
const corto = (r: any) => `${r.status} ${r.texto.slice(0, 300)}`;
const estado = async (api: Api) => (await api.pedir("GET", "/_estado")).cuerpo;

test("suplantación con socioId en el cuerpo", () =>
  conApi(async (api) => {
    const r1 = await api.pedir("POST", "/api/esperas", { socio: "socio-003", cuerpo: { ...A, socioId: "socio-041" } });
    console.log("socio-003 con socioId socio-041 ->", corto(r1));
    const r2 = await api.pedir("POST", "/api/esperas", { socio: "socio-011", cuerpo: { pistaId: "pista-1", inicio: "2026-11-19T18:00", socioId: "socio-006" } });
    console.log("socio-011 (sin cuota) con socioId socio-006 ->", corto(r2));
    console.log("GET de socio-041 ->", corto(await api.pedir("GET", "/api/esperas", { socio: "socio-041" })));
    console.log("GET de socio-003 ->", corto(await api.pedir("GET", "/api/esperas", { socio: "socio-003" })));
  }));

test("pista cerrada al cancelar", () =>
  conApi(async (api) => {
    const e = (await api.pedir("POST", "/api/esperas", { socio: "socio-041", cuerpo: A })).cuerpo.espera;
    console.log("cierre ->", (await api.pedir("PATCH", "/api/pistas/pista-1", { socio: GESTOR, cuerpo: { estado: "cerrada" } })).status);
    const c = await api.pedir("POST", "/api/reservas/R-0515/cancelar", {});
    console.log("cancelar con pista cerrada ->", corto(c));
    const est = await estado(api);
    console.log("R-0515 en /_estado:", JSON.stringify(est.reservas.find((x: any) => x.id === "R-0515")));
    console.log("espera:", JSON.stringify(est.esperas.find((x: any) => x.id === e.id)));
    console.log("confirmadas en la franja:", est.reservas.filter((x: any) => x.pistaId === A.pistaId && x.inicio === A.inicio && x.estado === "confirmada").length);
    console.log("reintento ->", corto(await api.pedir("POST", "/api/reservas/R-0515/cancelar", {})));
    console.log("GET de socio-041 ->", corto(await api.pedir("GET", "/api/esperas", { socio: "socio-041" })));
  }));

test("pista cerrada sin lista: como en la base", () =>
  conApi(async (api) => {
    await api.pedir("PATCH", "/api/pistas/pista-1", { socio: GESTOR, cuerpo: { estado: "cerrada" } });
    console.log("cancelar sin lista con pista cerrada ->", corto(await api.pedir("POST", "/api/reservas/R-0515/cancelar", {})));
  }));

test("cancelar una no_presentada (solo con el reloj hacia atrás)", () =>
  conApi(async (api) => {
    const est0 = await estado(api);
    const np = est0.reservas.find((r: any) => r.estado === "no_presentada" && r.pistaId !== "pista-4");
    console.log("no_presentada:", JSON.stringify(np));
    console.log("cancelar sin mover el reloj ->", corto(await api.pedir("POST", `/api/reservas/${np.id}/cancelar`, { cuerpo: { forzar: true } })));
    // Reloj hacia atrás: la franja de la no_presentada queda en el futuro y libre.
    const atras = np.inicio.slice(0, 10) + "T00:00";
    await api.pedir("POST", "/_reloj", { cuerpo: { ahora: sumarDias(atras, -3) } });
    const otra = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-006", pistaId: np.pistaId, inicio: np.inicio } });
    console.log("reservar la franja de la no_presentada ->", corto(otra));
    const e = await api.pedir("POST", "/api/esperas", { socio: "socio-041", cuerpo: { pistaId: np.pistaId, inicio: np.inicio } });
    console.log("espera ->", corto(e));
    const c = await api.pedir("POST", `/api/reservas/${np.id}/cancelar`, {});
    console.log("cancelar la no_presentada ->", corto(c));
    const est = await estado(api);
    console.log("no_presentada tras cancelar:", JSON.stringify(est.reservas.find((x: any) => x.id === np.id)));
    console.log("espera tras cancelar:", JSON.stringify(est.esperas.find((x: any) => x.id === e.cuerpo?.espera?.id)));
    console.log("confirmadas en la franja:", JSON.stringify(est.reservas.filter((x: any) => x.pistaId === np.pistaId && x.inicio === np.inicio && x.estado === "confirmada").map((x: any) => [x.id, x.socioId])));
  }));

function sumarDias(fh: string, d: number) {
  return new Date(Date.parse(`${fh}:00Z`) + d * 86_400_000).toISOString().slice(0, 16);
}

test("retirar una espera cuya franja ya empezó", () =>
  conApi(async (api) => {
    const e = (await api.pedir("POST", "/api/esperas", { socio: "socio-003", cuerpo: A })).cuerpo.espera;
    await api.pedir("POST", "/_reloj", { cuerpo: { ahora: A.inicio } });
    const d = await api.pedir("DELETE", `/api/esperas/${e.id}`, { socio: "socio-003" });
    console.log("DELETE de la caducada, sin leer antes ->", corto(d));
    console.log("espera en /_estado:", JSON.stringify((await estado(api)).esperas.find((x: any) => x.id === e.id)));
  }));

test("retirar una caducada después de un GET", () =>
  conApi(async (api) => {
    const e = (await api.pedir("POST", "/api/esperas", { socio: "socio-003", cuerpo: A })).cuerpo.espera;
    await api.pedir("POST", "/_reloj", { cuerpo: { ahora: A.inicio } });
    await api.pedir("GET", "/api/esperas", { socio: "socio-003" });
    console.log("DELETE de la caducada tras un GET ->", corto(await api.pedir("DELETE", `/api/esperas/${e.id}`, { socio: "socio-003" })));
  }));
