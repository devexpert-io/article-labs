// Sonda: número de factura de un año con cero inicial (0999), por diciembre (que sí se da por cerrado) y por enero.
import { test } from "node:test";
import { arrancarApi } from "./ayuda.ts";

const GESTOR = "socio-040";

function ver(etiqueta: string, valor: unknown) {
  console.log(`SONDA ${etiqueta} => ${JSON.stringify(valor)}`);
}

test("sonda año 0999", { timeout: 60_000 }, async () => {
  for (const [mes, inicio, despues] of [["0999-12", "0999-12-10T09:00", "2026-11-18T10:00"], ["0999-01", "0999-01-10T09:00", "2026-11-18T10:00"], ["0999-01", "0999-01-10T09:00", "9999-01-01T00:00"]] as const) {
    const api = await arrancarApi({ TZ: "UTC", AHORA: `${mes}-01T00:00` });
    try {
      const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-041", pistaId: "pista-1", inicio } });
      ver(`reserva ${inicio}`, { status: r.status, id: r.cuerpo?.reserva?.id });
      await api.pedir("POST", "/_reloj", { cuerpo: { ahora: despues } });
      const g = await api.pedir("POST", "/api/facturas", { cuerpo: { mes }, socio: GESTOR });
      ver(`generar ${mes} con el reloj a ${despues}`, { status: g.status, codigo: g.cuerpo?.error?.codigo, numeros: g.cuerpo?.facturas?.map((f: any) => f.numero) });
    } finally {
      api.cerrar();
    }
  }
});
