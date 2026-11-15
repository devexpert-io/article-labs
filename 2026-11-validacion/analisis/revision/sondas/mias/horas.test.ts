import { test } from "node:test";
import { arrancarApi } from "./ayuda.ts";
test("horas mal escritas", { timeout: 60_000 }, async () => {
  const api = await arrancarApi({ AHORA: "2026-11-20T10:00", TZ: "UTC" });
  try {
    for (const inicio of ["2026-12-01T10:60", "2026-12-01T09:90", "2026-12-01T99:00"]) {
      const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-001", pistaId: "pista-1", inicio } });
      console.log(`@@ ${inicio} -> ${r.status} ${r.texto.slice(0, 160)}`);
    }
  } finally { api.cerrar(); }
});
