// Sonda: fechas imposibles y año 9999 en POST /api/series, comparadas con POST /api/reservas en el mismo estado.
import { test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

const GESTOR = "socio-040";

async function sociosAlDia(api: Api): Promise<string[]> {
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  return estado.socios.filter((s: any) => s.rol === "socio" && s.cuotaActiva === true).map((s: any) => s.id);
}

async function inicios(api: Api, socioId: string): Promise<string[]> {
  const r = await api.pedir("GET", `/api/reservas?socio=${socioId}&limite=100`);
  return (r.cuerpo?.reservas ?? []).filter((x: any) => x.inicio >= "2027" || x.inicio.startsWith("+") || x.inicio.startsWith("9")).map((x: any) => `${x.inicio}${x.estado === "confirmada" ? "" : "(" + x.estado + ")"}`).sort();
}

test("fechas imposibles", { timeout: 60_000 }, async () => {
  const api = await arrancarApi({ AHORA: "2027-01-04T10:00", TZ: "UTC" });
  try {
    const socios = await sociosAlDia(api);
    let i = 0;
    const casos = ["2027-13-01T10:30", "2027-00-10T10:30", "2027-01-00T10:30", "2027-12-32T10:30", "2027-02-30T10:30", "2027-02-29T10:30", "2027-04-31T10:30"];
    for (const inicio of casos) {
      const a = socios[i++]!;
      const b = socios[i++]!;
      const s = await api.pedir("POST", "/api/series", { cuerpo: { socioId: a, pistaId: "pista-1", inicio, semanas: 2 }, socio: GESTOR });
      const serie = s.cuerpo?.serie;
      const n = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: b, pistaId: "pista-3", inicio } });
      console.log(`SERIE ${inicio} -> ${s.status} ${s.cuerpo?.error?.codigo ?? ""} serie.inicio=${serie?.inicio ?? "-"} reservas=${JSON.stringify(await inicios(api, a))} saltadas=${JSON.stringify(serie?.saltadas ?? null)} | NORMAL -> ${n.status} ${n.cuerpo?.error?.codigo ?? n.cuerpo?.reserva?.inicio}`);
    }
  } finally {
    api.cerrar();
  }
});

test("año 9999", { timeout: 60_000 }, async () => {
  const api = await arrancarApi({ AHORA: "2027-01-04T10:00", TZ: "UTC" });
  try {
    const [a, b] = await sociosAlDia(api);
    const s = await api.pedir("POST", "/api/series", { cuerpo: { socioId: a, pistaId: "pista-1", inicio: "9999-12-28T19:30", semanas: 2 }, socio: GESTOR });
    console.log(`9999 SERIE -> ${s.status} ${s.cuerpo?.error?.codigo ?? ""} reservas=${JSON.stringify(await inicios(api, a!))}`);
    const n = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: b, pistaId: "pista-3", inicio: "9999-12-28T19:30" } });
    console.log(`9999 NORMAL -> ${n.status} ${n.cuerpo?.error?.codigo ?? n.cuerpo?.reserva?.inicio}`);
    if (s.cuerpo?.serie?.id) {
      const c = await api.pedir("POST", `/api/series/${s.cuerpo.serie.id}/cancelar`, { cuerpo: { forzar: true }, socio: GESTOR });
      const ids = (l: any) => (Array.isArray(l) ? l.map((x: any) => (typeof x === "object" ? x.id : x)) : l);
      console.log(`9999 CANCELAR forzar -> ${c.status} canceladas=${JSON.stringify(ids(c.cuerpo?.canceladas))} pendientes=${JSON.stringify(ids(c.cuerpo?.pendientes))} despues=${JSON.stringify(await inicios(api, a!))}`);
    }
  } finally {
    api.cerrar();
  }
});
