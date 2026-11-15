// Fechas imposibles: qué hace reservar (base) y qué hace apuntarse en el estado.
import { test } from "node:test";
import { arrancarApi } from "./ayuda.ts";

const corto = (r: any) => `${r.status} ${r.texto.slice(0, 220)}`;

test("fechas imposibles", async () => {
  const api = await arrancarApi();
  try {
    for (const inicio of ["2026-13-45T09:00", "2027-02-31T10:30"]) {
      console.log("ESPERA antes de reservar", inicio, "->", corto(await api.pedir("POST", "/api/esperas", { socio: "socio-003", cuerpo: { pistaId: "pista-1", inicio } })));
      console.log("RESERVA", inicio, "->", corto(await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-006", pistaId: "pista-1", inicio } })));
      console.log("ESPERA tras reservar", inicio, "->", corto(await api.pedir("POST", "/api/esperas", { socio: "socio-003", cuerpo: { pistaId: "pista-1", inicio } })));
    }
  } finally {
    api.cerrar();
  }
});
