// Sonda: forma de las respuestas de las series y orden de las comprobaciones de permisos frente a rutas y cuerpos rotos.
import { test } from "node:test";
import { arrancarApi } from "./ayuda.ts";

const GESTOR = "socio-040";

test("forma y permisos", { timeout: 60_000 }, async () => {
  const api = await arrancarApi({ AHORA: "2027-01-04T10:00", TZ: "UTC" });
  try {
    const crudo = async (metodo: string, ruta: string, cuerpo: string | undefined, socio?: string) => {
      const cab: Record<string, string> = { "content-type": "application/json" };
      if (socio) cab["x-socio"] = socio;
      const r = await fetch(`${api.base}${ruta}`, { method: metodo, headers: cab, body: cuerpo });
      const t = await r.text();
      let c: any = t;
      try { c = JSON.parse(t); } catch {}
      return `${r.status} ${c?.error?.codigo ?? ""}`;
    };
    const s = await api.pedir("POST", "/api/series", { cuerpo: { socioId: "socio-001", pistaId: "pista-1", inicio: "2027-01-05T10:30", semanas: 3 }, socio: GESTOR });
    const serie = s.cuerpo?.serie;
    console.log(`POST ${s.status} claves=${JSON.stringify(Object.keys(s.cuerpo ?? {}))} serie=${JSON.stringify(Object.keys(serie ?? {}))} reservas[0]=${JSON.stringify(serie?.reservas?.[0])}`);
    if (s.cuerpo?.reservas) console.log(`POST top-level reservas[0]=${JSON.stringify(s.cuerpo.reservas[0])}`);
    const g = await api.pedir("GET", `/api/series/${serie?.id}`, { socio: GESTOR });
    console.log(`GET ${g.status} reservas[0] tipo=${typeof g.cuerpo?.serie?.reservas?.[0]} serieId=${g.cuerpo?.serie?.reservas?.[0]?.serieId}`);
    const unaId = typeof serie?.reservas?.[0] === "string" ? serie.reservas[0] : serie?.reservas?.[0]?.id;
    const una = await api.pedir("GET", `/api/reservas/${unaId}`);
    console.log(`GET reserva ${unaId} serieId=${una.cuerpo?.reserva?.serieId}`);

    console.log(`cuerpo roto POST /api/series sin X-Socio -> ${await crudo("POST", "/api/series", "{roto", undefined)}`);
    console.log(`cuerpo roto POST /api/series socio-003 -> ${await crudo("POST", "/api/series", "{roto", "socio-003")}`);
    console.log(`cuerpo roto POST cancelar sin X-Socio -> ${await crudo("POST", `/api/series/${serie?.id}/cancelar`, "{roto", undefined)}`);
    console.log(`cuerpo roto POST cancelar socio-003 -> ${await crudo("POST", `/api/series/${serie?.id}/cancelar`, "{roto", "socio-003")}`);
    console.log(`GET /api/series sin X-Socio -> ${await crudo("GET", "/api/series", undefined, undefined)}`);
    console.log(`GET /api/series gestor -> ${await crudo("GET", "/api/series", undefined, GESTOR)}`);
    console.log(`DELETE /api/series/S-0001 sin X-Socio -> ${await crudo("DELETE", "/api/series/S-0001", undefined, undefined)}`);
    console.log(`DELETE /api/series/S-0001 gestor -> ${await crudo("DELETE", "/api/series/S-0001", undefined, GESTOR)}`);
    console.log(`GET /api/series/S-9999 gestor -> ${await crudo("GET", "/api/series/S-9999", undefined, GESTOR)}`);
    console.log(`POST /api/series/S-9999/cancelar gestor -> ${await crudo("POST", "/api/series/S-9999/cancelar", "{}", GESTOR)}`);
    console.log(`POST cancelar forzar="si" gestor -> ${await crudo("POST", `/api/series/${serie?.id}/cancelar`, JSON.stringify({ forzar: "si" }), GESTOR)}`);
    const c = await api.pedir("POST", `/api/series/${serie?.id}/cancelar`, { cuerpo: {}, socio: GESTOR });
    console.log(`CANCELAR ${c.status} claves=${JSON.stringify(Object.keys(c.cuerpo ?? {}))} canceladas[0]=${JSON.stringify(c.cuerpo?.canceladas?.[0])?.slice(0, 80)}`);
    // Cancelar una reserva normal con la X-Socio de otro socio (en la base cualquiera puede).
    const n = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-003", pistaId: "pista-2", inicio: "2027-01-08T10:30" } });
    const cn = await api.pedir("POST", `/api/reservas/${n.cuerpo?.reserva?.id}/cancelar`, { cuerpo: {}, socio: "socio-007" });
    console.log(`cancelar reserva de otro socio -> ${cn.status} ${cn.cuerpo?.reserva?.estado ?? cn.cuerpo?.error?.codigo}`);
    // Mensaje de FRANJA_INVALIDA de una reserva normal.
    const fi = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-003", pistaId: "pista-2", inicio: "2027-01-08T10:00" } });
    console.log(`FRANJA_INVALIDA normal -> ${fi.status} ${fi.cuerpo?.error?.mensaje}`);
  } finally {
    api.cerrar();
  }
});
