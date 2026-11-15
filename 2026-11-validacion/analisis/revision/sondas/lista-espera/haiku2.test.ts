// Sonda para los hallazgos de lista-espera-haiku-r2 (c5150ab, 45b2408, 87cc7c9).
import { test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

const GESTOR = "socio-040";
const F = { pistaId: "pista-2", inicio: "2026-11-25T12:00" };

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
const reservar = (api: Api, socioId: string, f: { pistaId: string; inicio: string }) =>
  api.pedir("POST", "/api/reservas", { cuerpo: { socioId, ...f } });
const apuntar = (api: Api, socio: string, f: { pistaId: string; inicio: string }) => api.pedir("POST", "/api/esperas", { socio, cuerpo: f });

test("B1/h1: el socio reserva después la franja que espera", () =>
  conApi(async (api) => {
    const ocupante = (await reservar(api, "socio-012", F)).cuerpo.reserva.id;
    const e3 = (await apuntar(api, "socio-003", F)).cuerpo.espera;
    const e13 = (await apuntar(api, "socio-013", F)).cuerpo.espera;
    console.log("esperas", e3.id, e3.posicion, e13.id, e13.posicion);
    await api.pedir("PATCH", "/api/pistas/pista-2", { socio: GESTOR, cuerpo: { estado: "cerrada" } });
    console.log("cancelar con pista cerrada ->", corto(await api.pedir("POST", `/api/reservas/${ocupante}/cancelar`, {})));
    await api.pedir("PATCH", "/api/pistas/pista-2", { socio: GESTOR, cuerpo: { estado: "operativa" } });
    const directa = await reservar(api, "socio-003", F);
    console.log("socio-003 reserva directamente ->", corto(directa));
    console.log("GET esperas socio-003 ->", corto(await api.pedir("GET", "/api/esperas", { socio: "socio-003" })));
    console.log("GET esperas socio-013 ->", corto(await api.pedir("GET", "/api/esperas", { socio: "socio-013" })));
    const c2 = await api.pedir("POST", `/api/reservas/${directa.cuerpo.reserva.id}/cancelar`, {});
    console.log("socio-003 cancela su reserva ->", corto(c2));
    if (c2.cuerpo?.asignadaA) console.log("asignada a ->", corto(await api.pedir("GET", `/api/reservas/${c2.cuerpo.asignadaA}`)));
    const est = await estado(api);
    console.log("esperas finales:", JSON.stringify(est.esperas.map((e: any) => [e.id, e.socioId, e.estado])));
  }));

test("B1/h2: registro con socioId en el cuerpo", () =>
  conApi(async (api) => {
    await reservar(api, "socio-030", { pistaId: "pista-1", inicio: "2026-11-25T19:30" });
    const r = await api.pedir("POST", "/api/esperas", { socio: "socio-003", cuerpo: { pistaId: "pista-1", inicio: "2026-11-25T19:30", socioId: "socio-999" } });
    console.log("POST con socioId ajeno ->", corto(r));
    const est = await estado(api);
    console.log("espera guardada:", JSON.stringify(est.esperas.at(-1)));
    console.log("registro:", JSON.stringify(est.registro.at(-1)));
    // ¿Pasa lo mismo en una ruta de la base? cancelar con reservaId en el cuerpo
    const otra = (await reservar(api, "socio-031", { pistaId: "pista-3", inicio: "2026-11-25T19:30" })).cuerpo.reserva.id;
    await api.pedir("POST", `/api/reservas/${otra}/cancelar`, { cuerpo: { reservaId: "R-FALSA" } });
    console.log("registro de cancelar con reservaId en el cuerpo:", JSON.stringify((await estado(api)).registro.at(-1)));
  }));

test("B1/h3 y B3/h7: ?socio= vacío e inexistente", () =>
  conApi(async (api) => {
    await reservar(api, "socio-012", F);
    await apuntar(api, "socio-003", F);
    console.log("GET ?socio= como socio ->", corto(await api.pedir("GET", "/api/esperas?socio=", { socio: "socio-003" })));
    console.log("GET ?socio= como gestor ->", corto(await api.pedir("GET", "/api/esperas?socio=", { socio: GESTOR })));
    console.log("GET ?socio=socio-999 como gestor ->", corto(await api.pedir("GET", "/api/esperas?socio=socio-999", { socio: GESTOR })));
  }));

test("pista cerrada al cancelar", () =>
  conApi(async (api) => {
    const ocupante = (await reservar(api, "socio-012", F)).cuerpo.reserva.id;
    const e = (await apuntar(api, "socio-003", F)).cuerpo.espera;
    await api.pedir("PATCH", "/api/pistas/pista-2", { socio: GESTOR, cuerpo: { estado: "cerrada" } });
    console.log("cancelar con pista cerrada ->", corto(await api.pedir("POST", `/api/reservas/${ocupante}/cancelar`, {})));
    const est = await estado(api);
    console.log("espera:", JSON.stringify(est.esperas.find((x: any) => x.id === e.id)));
    console.log("confirmadas en la franja:", est.reservas.filter((x: any) => x.pistaId === F.pistaId && x.inicio === F.inicio && x.estado === "confirmada").length);
  }));

test("B2/h1: reservar con una espera propia activa en otra franja ocupada", () =>
  conApi(async (api) => {
    // Reservar normal: la respuesta no cambia.
    const r = await reservar(api, "socio-004", { pistaId: "pista-2", inicio: "2026-11-21T16:30" });
    console.log("reserva normal ->", corto(r));
  }));

test("caducidad: /_estado y DELETE de una caducada", () =>
  conApi(async (api) => {
    await reservar(api, "socio-012", F);
    const e = (await apuntar(api, "socio-003", F)).cuerpo.espera;
    await api.pedir("POST", "/_reloj", { cuerpo: { ahora: F.inicio } });
    console.log("GET tras empezar ->", corto(await api.pedir("GET", "/api/esperas", { socio: "socio-003" })));
    console.log("espera en /_estado:", JSON.stringify((await estado(api)).esperas.find((x: any) => x.id === e.id)));
    console.log("DELETE caducada ->", corto(await api.pedir("DELETE", `/api/esperas/${e.id}`, { socio: "socio-003" })));
  }));
