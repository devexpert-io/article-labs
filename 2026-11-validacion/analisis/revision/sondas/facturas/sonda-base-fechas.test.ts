// Sonda en la base: cómo valida las fechas de los filtros (solo la forma) y la identidad (X-Socio sin autenticación).
import { test } from "node:test";
import { arrancarApi } from "./ayuda.ts";

test("sonda base", { timeout: 60_000 }, async () => {
  const api = await arrancarApi({ TZ: "UTC" });
  try {
    for (const ruta of ["/api/reservas?fecha=2026-99-99", "/api/reservas?desde=2026-02-30", "/api/disponibilidad?fecha=2026-99-99"]) {
      const r = await api.pedir("GET", ruta);
      console.log(`SONDA base ${ruta} => ${JSON.stringify({ status: r.status, codigo: r.cuerpo?.error?.codigo, total: r.cuerpo?.total })}`);
    }
    const e = await api.pedir("GET", "/_estado");
    console.log(`SONDA base /_estado sin X-Socio => ${JSON.stringify({ status: e.status, claves: Object.keys(e.cuerpo), socios: e.cuerpo.socios.length, email: e.cuerpo.socios[0].email })}`);
    const g = await api.pedir("GET", "/api/pistas", { socio: "socio-040" });
    console.log(`SONDA base X-Socio socio-040 sin credenciales => ${g.status}`);
    const r = await api.pedir("GET", "/api/reservas/R-0012");
    console.log(`SONDA base R-0012 => ${JSON.stringify(r.cuerpo.reserva)}`);
  } finally {
    api.cerrar();
  }
});
