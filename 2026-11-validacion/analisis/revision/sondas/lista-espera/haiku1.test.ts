// Sonda para los hallazgos de lista-espera-haiku-r1 (d2e8bf0, 5120ff5, c04c1c3).
import assert from "node:assert/strict";
import { test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

const GESTOR = "socio-040";
const A = { pistaId: "pista-1", inicio: "2026-11-19T19:30" }; // ocupada por socio-007 en la semilla

async function conApi(fn: (api: Api) => Promise<void>) {
  const api = await arrancarApi();
  try {
    await fn(api);
  } finally {
    api.cerrar();
  }
}
const corto = (r: any) => `${r.status} ${r.texto.slice(0, 260)}`;
async function estado(api: Api) {
  return (await api.pedir("GET", "/_estado")).cuerpo;
}
async function reservaDe(api: Api, pistaId: string, inicio: string) {
  const e = await estado(api);
  return e.reservas.find((r: any) => r.pistaId === pistaId && r.inicio === inicio && r.estado === "confirmada");
}

test("fechas imposibles al apuntarse", () =>
  conApi(async (api) => {
    for (const inicio of ["2026-13-45T09:00", "2026-02-30T09:00", "2027-02-31T10:30"]) {
      const r = await api.pedir("POST", "/api/esperas", { socio: "socio-003", cuerpo: { pistaId: "pista-1", inicio } });
      console.log("ESPERA fecha imposible", inicio, "->", corto(r));
    }
    // Si la fecha imposible se reserva (la base lo acepta), ¿se puede esperar esa franja?
    const res = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-006", pistaId: "pista-1", inicio: "2026-02-30T09:00" } });
    console.log("RESERVA fecha imposible 2026-02-30T09:00 ->", corto(res));
    const r2 = await api.pedir("POST", "/api/esperas", { socio: "socio-003", cuerpo: { pistaId: "pista-1", inicio: "2026-02-30T09:00" } });
    console.log("ESPERA sobre la reserva imposible ->", corto(r2));
  }));

test("403 frente a 404 al retirar", () =>
  conApi(async (api) => {
    const e = (await api.pedir("POST", "/api/esperas", { socio: "socio-003", cuerpo: A })).cuerpo.espera;
    console.log("espera", JSON.stringify(e));
    console.log("DELETE ajena ->", corto(await api.pedir("DELETE", `/api/esperas/${e.id}`, { socio: "socio-006" })));
    console.log("DELETE inexistente ->", corto(await api.pedir("DELETE", `/api/esperas/E-9999`, { socio: "socio-006" })));
  }));

test("pista cerrada al cancelar", () =>
  conApi(async (api) => {
    const e = (await api.pedir("POST", "/api/esperas", { socio: "socio-003", cuerpo: A })).cuerpo.espera;
    const r = await reservaDe(api, A.pistaId, A.inicio);
    console.log("cierre ->", corto(await api.pedir("PATCH", `/api/pistas/${A.pistaId}`, { socio: GESTOR, cuerpo: { estado: "cerrada" } })));
    const c = await api.pedir("POST", `/api/reservas/${r.id}/cancelar`, {});
    console.log("cancelar con pista cerrada ->", corto(c));
    const est = await estado(api);
    console.log("espera tras cancelar:", JSON.stringify(est.esperas.find((x: any) => x.id === e.id)));
    console.log("confirmadas en la franja:", JSON.stringify(est.reservas.filter((x: any) => x.pistaId === A.pistaId && x.inicio === A.inicio && x.estado === "confirmada")));
    console.log("pista:", JSON.stringify(est.pistas.find((p: any) => p.id === A.pistaId)));
  }));

test("socio vacío en GET", () =>
  conApi(async (api) => {
    await api.pedir("POST", "/api/esperas", { socio: "socio-003", cuerpo: A });
    console.log("GET ?socio= como socio ->", corto(await api.pedir("GET", "/api/esperas?socio=", { socio: "socio-003" })));
    console.log("GET ?socio= como gestor ->", corto(await api.pedir("GET", "/api/esperas?socio=", { socio: GESTOR })));
    console.log("GET ?socio=socio-999 como gestor ->", corto(await api.pedir("GET", "/api/esperas?socio=socio-999", { socio: GESTOR })));
  }));

test("prioridad cuota frente a franja libre", () =>
  conApi(async (api) => {
    const libre = { pistaId: "pista-2", inicio: "2026-11-19T19:30" };
    console.log("moroso en franja libre (espera) ->", corto(await api.pedir("POST", "/api/esperas", { socio: "socio-011", cuerpo: libre })));
    console.log("moroso en franja libre (reserva) ->", corto(await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-011", ...libre } })));
  }));

test("caducidad perezosa en /_estado", () =>
  conApi(async (api) => {
    const e = (await api.pedir("POST", "/api/esperas", { socio: "socio-003", cuerpo: A })).cuerpo.espera;
    await api.pedir("POST", "/_reloj", { cuerpo: { ahora: "2026-11-19T19:45" } });
    console.log("GET tras empezar ->", corto(await api.pedir("GET", "/api/esperas", { socio: "socio-003" })));
    console.log("espera en /_estado:", JSON.stringify((await estado(api)).esperas.find((x: any) => x.id === e.id)));
  }));

test("YA_RESERVADA solo por pista y hora", () =>
  conApi(async (api) => {
    // socio-007 tiene pista-1 19:30. ¿Puede esperar pista-2 19:30 si está ocupada?
    const ocupa = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-006", pistaId: "pista-2", inicio: "2026-11-19T19:30" } });
    console.log("ocupar pista-2 19:30 ->", corto(ocupa));
    console.log("socio-007 espera pista-2 19:30 ->", corto(await api.pedir("POST", "/api/esperas", { socio: "socio-007", cuerpo: { pistaId: "pista-2", inicio: "2026-11-19T19:30" } })));
    console.log("socio-007 espera pista-1 19:30 ->", corto(await api.pedir("POST", "/api/esperas", { socio: "socio-007", cuerpo: A })));
  }));

test("registro de apuntarse con socioId en el cuerpo", () =>
  conApi(async (api) => {
    const r = await api.pedir("POST", "/api/esperas", { socio: "socio-003", cuerpo: { ...A, socioId: "socio-999" } });
    console.log("POST con socioId ajeno ->", corto(r));
    const est = await estado(api);
    console.log("registro:", JSON.stringify(est.registro.at(-1)));
  }));

test("rutas que cambian la cuota", () =>
  conApi(async (api) => {
    for (const [m, ruta] of [["PATCH", "/api/socios/socio-003"], ["POST", "/api/socios/socio-003"], ["PUT", "/api/socios/socio-003"]] as const) {
      console.log(m, ruta, "->", corto(await api.pedir(m, ruta, { socio: GESTOR, cuerpo: { cuotaActiva: false } })));
    }
    assert.ok(true);
  }));
