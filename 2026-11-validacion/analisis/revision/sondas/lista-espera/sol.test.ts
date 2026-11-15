// Sonda para sol-r1 (a73ff03) y sol-r2 (d69f59c): DELETE de esperas que ya no están activas.
import { test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

const GESTOR = "socio-040";
const A = { pistaId: "pista-1", inicio: "2026-11-19T19:30" }; // ocupada por socio-007 (R-0515)
const B = { pistaId: "pista-1", inicio: "2026-11-19T18:00" }; // ocupada por socio-011

async function conApi(fn: (api: Api) => Promise<void>) {
  const api = await arrancarApi();
  try {
    await fn(api);
  } finally {
    api.cerrar();
  }
}
const corto = (r: any) => `${r.status} ${r.texto.slice(0, 260)}`;

test("DELETE de una espera asignada, descartada, retirada y caducada", () =>
  conApi(async (api) => {
    const asignada = (await api.pedir("POST", "/api/esperas", { socio: "socio-003", cuerpo: A })).cuerpo.espera;
    const c = await api.pedir("POST", "/api/reservas/R-0515/cancelar", {});
    console.log("cancelar ->", c.status, "asignadaA", c.cuerpo.asignadaA);
    console.log("DELETE asignada (dueño) ->", corto(await api.pedir("DELETE", `/api/esperas/${asignada.id}`, { socio: "socio-003" })));
    console.log("DELETE asignada (gestor) ->", corto(await api.pedir("DELETE", `/api/esperas/${asignada.id}`, { socio: GESTOR })));
    console.log("la reserva asignada sigue:", corto(await api.pedir("GET", `/api/reservas/${c.cuerpo.asignadaA}`)));
    const e2 = (await api.pedir("POST", "/api/esperas", { socio: "socio-006", cuerpo: B })).cuerpo.espera;
    console.log("DELETE activa ->", corto(await api.pedir("DELETE", `/api/esperas/${e2.id}`, { socio: "socio-006" })));
    console.log("DELETE retirada otra vez ->", corto(await api.pedir("DELETE", `/api/esperas/${e2.id}`, { socio: "socio-006" })));
    const e3 = (await api.pedir("POST", "/api/esperas", { socio: "socio-008", cuerpo: B })).cuerpo.espera;
    await api.pedir("POST", "/_reloj", { cuerpo: { ahora: B.inicio } });
    console.log("DELETE caducada ->", corto(await api.pedir("DELETE", `/api/esperas/${e3.id}`, { socio: "socio-008" })));
  }));
