// Sonda de revisión (duraciones): efecto de una reserva guardada con inicio 10:60 sobre los solapes de otras reservas.
// Una reserva 10:00-11:00 no se solapa con otra que empieza a las 11:00 (10:60), así que debería crearse.
import assert from "node:assert/strict";
import { test } from "node:test";
import { arrancarApi } from "./ayuda.ts";

test("sonda efecto 10:60", { timeout: 60_000 }, async () => {
  const api = await arrancarApi({ TZ: "Europe/Madrid", AHORA: "2026-11-18T10:00" });
  try {
    const rara = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-003", pistaId: "pista-1", inicio: "2026-12-01T10:60", duracion: 60 } });
    console.log(`RARA 10:60+60 -> ${rara.status} ${rara.status === 201 ? `${rara.cuerpo.reserva.inicio}-${rara.cuerpo.reserva.fin}` : rara.texto.slice(0, 100)}`);
    const pegada = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-006", pistaId: "pista-1", inicio: "2026-12-01T10:00", duracion: 60 } });
    console.log(`PEGADA 10:00+60 -> ${pegada.status} ${pegada.cuerpo?.error?.codigo ?? ""}`);
    const otra = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-007", pistaId: "pista-1", inicio: "2026-12-02T10:00", duracion: 60 } });
    console.log(`CONTROL otro dia 10:00+60 -> ${otra.status}`);
    assert.ok(true);
  } finally {
    api.cerrar();
  }
});
