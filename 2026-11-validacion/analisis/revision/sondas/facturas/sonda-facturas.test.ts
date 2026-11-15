// Sonda de revisión para los hallazgos de `facturas`. No afirma nada: imprime lo que responde la API en cada caso.
import { test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

const GESTOR = "socio-040";
const OPCIONES = { timeout: 120_000 };

function ver(etiqueta: string, valor: unknown) {
  console.log(`SONDA ${etiqueta} => ${typeof valor === "string" ? valor : JSON.stringify(valor)}`);
}

async function conApi(entorno: Record<string, string>, prueba: (api: Api) => Promise<void>) {
  const api = await arrancarApi({ TZ: "UTC", ...entorno });
  try {
    await prueba(api);
  } catch (error) {
    ver("ERROR", String(error));
  } finally {
    api.cerrar();
  }
}

const generar = (api: Api, mes: unknown) => api.pedir("POST", "/api/facturas", { cuerpo: { mes }, socio: GESTOR });
const reloj = (api: Api, ahora: string) => api.pedir("POST", "/_reloj", { cuerpo: { ahora } });
const resumen = (r: { status: number; cuerpo: any; texto: string }) => ({
  status: r.status,
  codigo: r.cuerpo?.error?.codigo,
  n: Array.isArray(r.cuerpo?.facturas) ? r.cuerpo.facturas.length : undefined,
  numeros: Array.isArray(r.cuerpo?.facturas) ? r.cuerpo.facturas.map((f: any) => f.numero).slice(0, 3) : undefined,
});

test("sonda facturas", OPCIONES, async () => {
  // P1: /_estado después de generar octubre.
  await conApi({}, async (api) => {
    await generar(api, "2026-10");
    for (const socio of [undefined, "socio-003"]) {
      const e = await api.pedir("GET", "/_estado", { socio });
      ver(`P1 /_estado como ${socio ?? "anonimo"}`, {
        status: e.status,
        claves: Object.keys(e.cuerpo ?? {}),
        facturas: Array.isArray(e.cuerpo?.facturas) ? e.cuerpo.facturas.length : e.cuerpo?.facturas,
        mesesFacturados: e.cuerpo?.mesesFacturados,
      });
    }
    const api403 = await api.pedir("GET", "/api/facturas?mes=2026-10", { socio: "socio-003" });
    ver("P1 GET /api/facturas como socio-003", resumen(api403));
  });

  // P2: retroceder el reloj a un mes ya generado y volver a generarlo.
  await conApi({}, async (api) => {
    ver("P2 primera", resumen(await generar(api, "2026-10")));
    ver("P2 reloj", (await reloj(api, "2026-10-15T10:00")).status);
    ver("P2 repetir con el reloj en octubre", resumen(await generar(api, "2026-10")));
    ver("P2 GET con el reloj en octubre", resumen(await api.pedir("GET", "/api/facturas?mes=2026-10", { socio: GESTOR })));
  });

  // P3: un mes cerrado sin nada que facturar, dos veces.
  await conApi({}, async (api) => {
    ver("P3 2026-09 primera", resumen(await generar(api, "2026-09")));
    ver("P3 2026-09 segunda", resumen(await generar(api, "2026-09")));
    ver("P3 2026-09 tercera", resumen(await generar(api, "2026-09")));
    ver("P3 GET 2026-09", resumen(await api.pedir("GET", "/api/facturas?mes=2026-09", { socio: GESTOR })));
  });

  // P4: el último día del mes, el mes sigue abierto.
  for (const [ahora, mes] of [["2026-02-28T10:00", "2026-02"], ["2026-11-30T23:59", "2026-11"], ["2027-02-28T23:59", "2027-02"], ["2026-03-01T00:00", "2026-02"]] as const) {
    await conApi({ AHORA: ahora }, async (api) => ver(`P4 ${mes} con el reloj a ${ahora}`, resumen(await generar(api, mes))));
  }

  // P5: formatos imposibles.
  await conApi({}, async (api) => {
    for (const mes of ["2026-02-30", "2026-13", "2026-00", "2026-99"]) ver(`P5 mes=${mes}`, resumen(await generar(api, mes)));
  });

  // P6: diciembre de 9999 con el reloj en 2026, sin y con una reserva.
  await conApi({}, async (api) => {
    ver("P6 9999-12 sin reservas", resumen(await generar(api, "9999-12")));
  });
  await conApi({}, async (api) => {
    const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-041", pistaId: "pista-1", inicio: "9999-12-10T09:00" } });
    ver("P6 reserva en 9999-12", { status: r.status, id: r.cuerpo?.reserva?.id, codigo: r.cuerpo?.error?.codigo });
    const g = await generar(api, "9999-12");
    ver("P6 9999-12 con una reserva", { ...resumen(g), facturas: g.cuerpo?.facturas });
    for (const mes of ["9999-11", "9998-12", "2026-12"]) ver(`P6 ${mes}`, resumen(await generar(api, mes)));
  });

  // P7: años con cero inicial: 0999-10 con el reloj en 2026 (cerrado) y una factura de 0999-10.
  await conApi({}, async (api) => {
    for (const mes of ["0999-10", "0999-12", "1000-01", "1999-12"]) ver(`P7 ${mes} con el reloj en 2026`, resumen(await generar(api, mes)));
  });
  await conApi({ AHORA: "0999-10-01T00:00" }, async (api) => {
    const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-041", pistaId: "pista-1", inicio: "0999-10-10T09:00" } });
    ver("P7 reserva en 0999-10", { status: r.status, id: r.cuerpo?.reserva?.id, codigo: r.cuerpo?.error?.codigo });
    await reloj(api, "0999-11-01T00:00");
    const g = await generar(api, "0999-10");
    ver("P7 0999-10 con una reserva, reloj 0999-11-01", { ...resumen(g), facturas: g.cuerpo?.facturas });
    await reloj(api, "1000-01-01T00:00");
    ver("P7 0999-12 con el reloj a 1000-01-01T00:00", resumen(await generar(api, "0999-12")));
  });

  // P8: la reserva R-0012 de la semilla y la factura de octubre de su socio.
  await conApi({}, async (api) => {
    const r = await api.pedir("GET", "/api/reservas/R-0012");
    ver("P8 R-0012", r.cuerpo?.reserva);
    const canceladasOct = (await api.pedir("GET", "/api/reservas?desde=2026-10-01&hasta=2026-10-31&estado=cancelada&limite=100")).cuerpo;
    ver("P8 canceladas de octubre con penalizacion", canceladasOct.reservas.filter((x: any) => x.penalizacion !== undefined).map((x: any) => [x.id, x.socioId, x.penalizacion]));
    const g = await generar(api, "2026-10");
    const socio = r.cuerpo?.reserva?.socioId;
    const f = g.cuerpo?.facturas?.find((x: any) => x.socioId === socio);
    ver(`P8 factura de octubre de ${socio}`, f);
  });
});
