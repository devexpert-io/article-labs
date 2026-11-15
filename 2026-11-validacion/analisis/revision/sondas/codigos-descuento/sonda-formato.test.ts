// Sonda: orden de los errores de codigo frente a las reglas del club, codigos vacios y errores 404.
// Solo registra lo que responde la API (console.log). No afirma nada salvo que la API arranca.
import assert from "node:assert/strict";
import { test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

const reservar = (api: Api, cuerpo: Record<string, unknown>) => api.pedir("POST", "/api/reservas", { cuerpo });

function linea(etiqueta: string, r: { status: number; cuerpo: any }) {
  const res = r.cuerpo?.reserva;
  const resumen = res
    ? { id: res.id, importeBase: res.importeBase, descuento: res.descuento, importe: res.importe, codigo: res.codigo, tieneCodigo: "codigo" in res }
    : r.cuerpo?.error?.codigo;
  console.log(`SONDA ${etiqueta} -> ${r.status} ${JSON.stringify(resumen)}`);
}

test("sonda: orden de errores con codigos mal formados", async () => {
  const api = await arrancarApi();
  try {
    const estado = (await api.pedir("GET", "/_estado")).cuerpo;
    const inactivo = estado.socios.find((s: any) => s.cuotaActiva === false)?.id;
    console.log("SONDA socio inactivo:", inactivo);
    linea("pista-4 cerrada + NOEXISTE", await reservar(api, { socioId: "socio-003", pistaId: "pista-4", inicio: "2026-11-21T16:30", codigo: "NOEXISTE" }));
    linea("socio-999 + NOEXISTE", await reservar(api, { socioId: "socio-999", pistaId: "pista-2", inicio: "2026-11-21T16:30", codigo: "NOEXISTE" }));
    linea("franja pasada + NOEXISTE", await reservar(api, { socioId: "socio-003", pistaId: "pista-2", inicio: "2026-11-18T09:00", codigo: "NOEXISTE" }));
    linea(`cuota inactiva (${inactivo}) + NOEXISTE`, await reservar(api, { socioId: inactivo, pistaId: "pista-2", inicio: "2026-11-21T16:30", codigo: "NOEXISTE" }));
    linea("pista-4 cerrada + 123", await reservar(api, { socioId: "socio-003", pistaId: "pista-4", inicio: "2026-11-21T16:30", codigo: 123 }));
    linea(`cuota inactiva (${inactivo}) + 123`, await reservar(api, { socioId: inactivo, pistaId: "pista-2", inicio: "2026-11-21T16:30", codigo: 123 }));
    linea("socio-999 + 123", await reservar(api, { socioId: "socio-999", pistaId: "pista-2", inicio: "2026-11-21T16:30", codigo: 123 }));
    linea("socio-999 sin codigo", await reservar(api, { socioId: "socio-999", pistaId: "pista-2", inicio: "2026-11-21T16:30" }));
    linea("pista-9 sin codigo", await reservar(api, { socioId: "socio-003", pistaId: "pista-9", inicio: "2026-11-21T16:30" }));
    linea("pista-4 cerrada + BIENVENIDA (socio con reservas)", await reservar(api, { socioId: "socio-003", pistaId: "pista-4", inicio: "2026-11-21T16:30", codigo: "BIENVENIDA" }));
  } finally {
    api.cerrar();
  }
});

test("sonda: codigo vacio o de espacios", async () => {
  const api = await arrancarApi();
  try {
    assert.equal((await api.pedir("POST", "/_reloj", { cuerpo: { ahora: "2026-12-07T08:00" } })).status, 200);
    const total = async (id: string) => (await api.pedir("GET", `/api/reservas?socio=${id}&limite=1`)).cuerpo.total;
    const antes3 = await total("socio-003");
    linea("codigo '' (socio-003)", await reservar(api, { socioId: "socio-003", pistaId: "pista-1", inicio: "2026-12-09T13:30", codigo: "" }));
    console.log("SONDA reservas socio-003 antes/despues de '':", antes3, await total("socio-003"));
    const antes6 = await total("socio-006");
    linea("codigo '   ' (socio-006)", await reservar(api, { socioId: "socio-006", pistaId: "pista-1", inicio: "2026-12-09T15:00", codigo: "   " }));
    console.log("SONDA reservas socio-006 antes/despues de '   ':", antes6, await total("socio-006"));
    linea("codigo '\\t' (socio-008)", await reservar(api, { socioId: "socio-008", pistaId: "pista-1", inicio: "2026-12-09T16:30", codigo: "\t" }));
    linea("codigo null (socio-008)", await reservar(api, { socioId: "socio-008", pistaId: "pista-2", inicio: "2026-12-09T16:30", codigo: null }));
  } finally {
    api.cerrar();
  }
});

test("sonda: socio-041 existe y BIENVENIDA vale con ella", async () => {
  const api = await arrancarApi();
  try {
    const estado = (await api.pedir("GET", "/_estado")).cuerpo;
    const s41 = estado.socios.find((s: any) => s.id === "socio-041");
    console.log("SONDA socio-041:", JSON.stringify(s41), "reservas:", estado.reservas.filter((r: any) => r.socioId === "socio-041").length);
    console.log("SONDA ids de socios:", estado.socios.length, estado.socios.map((s: any) => s.id).slice(-4).join(","));
    linea("socio-041 BIENVENIDA pista-2 19-nov 19:30", await reservar(api, { socioId: "socio-041", pistaId: "pista-2", inicio: "2026-11-19T19:30", codigo: "BIENVENIDA" }));
    linea("socio-042 MANANAS", await reservar(api, { socioId: "socio-042", pistaId: "pista-2", inicio: "2026-11-19T09:00", codigo: "MANANAS" }));
  } finally {
    api.cerrar();
  }
});
