// Sonda: reservas futuras de socio-007 y franjas que usa el test CLUB10 de luna-r1 (2000fbf).
import { test } from "node:test";
import { arrancarApi } from "./ayuda.ts";

test("sonda: socio-007 y franjas del 20 de noviembre", async () => {
  const api = await arrancarApi();
  try {
    const estado = (await api.pedir("GET", "/_estado")).cuerpo;
    const futuras = estado.reservas.filter((r: any) => r.socioId === "socio-007" && r.estado === "confirmada" && r.inicio > estado.ahora);
    console.log("S007 futuras de socio-007:", JSON.stringify(futuras.map((r: any) => [r.id, r.pistaId, r.inicio])));
    const ocupadas = estado.reservas.filter((r: any) => r.pistaId === "pista-1" && r.estado === "confirmada" && ["2026-11-20T09:00", "2026-11-20T10:30", "2026-11-20T12:00", "2026-11-20T13:30", "2026-11-20T15:00"].includes(r.inicio));
    console.log("S007 ocupadas en pista-1 el 20:", JSON.stringify(ocupadas.map((r: any) => [r.id, r.inicio, r.socioId])));
    const p3 = estado.reservas.filter((r: any) => r.pistaId === "pista-3" && r.inicio === "2026-11-19T09:00");
    console.log("S007 pista-3 19-nov 09:00:", JSON.stringify(p3.map((r: any) => [r.id, r.socioId, r.estado])));
    const dia = new Date("2026-11-25T12:00:00Z").getUTCDay();
    console.log("S007 dia de la semana del 2026-11-25:", dia, "y del 2026-11-21:", new Date("2026-11-21T12:00:00Z").getUTCDay());
  } finally {
    api.cerrar();
  }
});
