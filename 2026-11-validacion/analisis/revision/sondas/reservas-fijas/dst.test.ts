// Sonda: plazo de 24 horas al cancelar una serie cuando entre medias cambia la hora, comparado con la cancelación
// normal en el mismo estado. Primavera: 2027-03-28 (a las 02:00 pasan a ser las 03:00). Otoño: 2027-10-31 (a las 03:00
// vuelven a ser las 02:00).
import { test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

const GESTOR = "socio-040";

async function sociosAlDia(api: Api): Promise<string[]> {
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  return estado.socios.filter((s: any) => s.rol === "socio" && s.cuotaActiva === true).map((s: any) => s.id);
}

async function reservasDe(api: Api, socioId: string): Promise<any[]> {
  const r = await api.pedir("GET", `/api/reservas?socio=${socioId}&desde=2027-01-01&limite=100`);
  return [...r.cuerpo.reservas].sort((a: any, b: any) => a.inicio.localeCompare(b.inicio));
}

const ids = (l: any) => (Array.isArray(l) ? l.map((x: any) => (typeof x === "object" ? x.id : x)) : l);
const corto = (r: any) => `${r.id} ${r.inicio} ${r.estado} pen=${r.penalizacion ?? "-"}`;

for (const TZ of ["UTC", "Europe/Madrid"]) {
  test(`cambio de hora TZ=${TZ}`, { timeout: 60_000 }, async () => {
    const api = await arrancarApi({ AHORA: "2027-03-01T10:00", TZ });
    try {
      const [a, b, c, d, e, f] = await sociosAlDia(api);
      const crear = async (socioId: string, pistaId: string, inicio: string) => {
        const r = await api.pedir("POST", "/api/series", { cuerpo: { socioId, pistaId, inicio, semanas: 2 }, socio: GESTOR });
        if (r.status !== 201) console.log(`crear ${inicio} -> ${r.status} ${r.texto.slice(0, 200)}`);
        return r.cuerpo.serie;
      };
      const normal = async (socioId: string, pistaId: string, inicio: string) => {
        const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio } });
        return r.cuerpo.reserva;
      };
      // Primavera: reserva el domingo 28 de marzo a las 10:30, reloj el sábado 27 a las 10:30 (24 h de reloj, 23 h reales).
      const sp = await crear(a!, "pista-1", "2027-03-28T10:30");
      const spf = await crear(e!, "pista-3", "2027-03-28T10:30");
      const np = await normal(b!, "pista-2", "2027-03-28T10:30");
      // Otoño: reserva el domingo 31 de octubre a las 10:30, reloj el sábado 30 a las 11:00 (23,5 h de reloj, 24,5 h reales).
      const ot = await crear(c!, "pista-1", "2027-10-31T10:30");
      const otf = await crear(f!, "pista-3", "2027-10-31T10:30");
      const no = await normal(d!, "pista-2", "2027-10-31T10:30");

      await api.pedir("POST", "/_reloj", { cuerpo: { ahora: "2027-03-27T10:30" } });
      const c1 = await api.pedir("POST", `/api/series/${sp?.id}/cancelar`, { cuerpo: {}, socio: GESTOR });
      console.log(`[${TZ}] PRIMAVERA serie sin forzar -> ${c1.status} canceladas=${JSON.stringify(ids(c1.cuerpo?.canceladas))} pendientes=${JSON.stringify(ids(c1.cuerpo?.pendientes))} :: ${(await reservasDe(api, a!)).map(corto).join(" | ")}`);
      const c1f = await api.pedir("POST", `/api/series/${spf?.id}/cancelar`, { cuerpo: { forzar: true }, socio: GESTOR });
      console.log(`[${TZ}] PRIMAVERA serie forzar -> ${c1f.status} :: ${(await reservasDe(api, e!)).map(corto).join(" | ")}`);
      const n1 = await api.pedir("POST", `/api/reservas/${np.id}/cancelar`, { cuerpo: {} });
      console.log(`[${TZ}] PRIMAVERA normal sin forzar -> ${n1.status} ${n1.cuerpo?.error?.codigo ?? corto(n1.cuerpo.reserva)}`);

      await api.pedir("POST", "/_reloj", { cuerpo: { ahora: "2027-10-30T11:00" } });
      const c2 = await api.pedir("POST", `/api/series/${ot?.id}/cancelar`, { cuerpo: {}, socio: GESTOR });
      console.log(`[${TZ}] OTONO serie sin forzar -> ${c2.status} canceladas=${JSON.stringify(ids(c2.cuerpo?.canceladas))} pendientes=${JSON.stringify(ids(c2.cuerpo?.pendientes))} :: ${(await reservasDe(api, c!)).map(corto).join(" | ")}`);
      const c2f = await api.pedir("POST", `/api/series/${otf?.id}/cancelar`, { cuerpo: { forzar: true }, socio: GESTOR });
      console.log(`[${TZ}] OTONO serie forzar -> ${c2f.status} :: ${(await reservasDe(api, f!)).map(corto).join(" | ")}`);
      const n2 = await api.pedir("POST", `/api/reservas/${no.id}/cancelar`, { cuerpo: {} });
      console.log(`[${TZ}] OTONO normal sin forzar -> ${n2.status} ${n2.cuerpo?.error?.codigo ?? corto(n2.cuerpo.reserva)}`);
    } finally {
      api.cerrar();
    }
  });
}
