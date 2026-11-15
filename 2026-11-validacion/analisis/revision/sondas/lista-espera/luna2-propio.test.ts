// Observación fuera del paquete: luna-r2, GET /api/esperas?socio=<propio id> como socio normal.
import { test } from "node:test";
import { arrancarApi } from "./ayuda.ts";
test("socio pide sus propias esperas con ?socio=", async () => {
  const api = await arrancarApi();
  try {
    await api.pedir("POST", "/api/esperas", { socio: "socio-003", cuerpo: { pistaId: "pista-1", inicio: "2026-11-19T19:30" } });
    const r = await api.pedir("GET", "/api/esperas?socio=socio-003", { socio: "socio-003" });
    console.log("GET ?socio=propio ->", r.status, r.texto.slice(0, 200));
  } finally {
    api.cerrar();
  }
});
