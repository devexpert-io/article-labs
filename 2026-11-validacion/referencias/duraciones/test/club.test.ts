// Las reglas básicas del club, probadas a través de la API.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

let api: Api;
before(async () => {
  api = await arrancarApi();
});
after(() => api.cerrar());

test("la semilla trae los socios, las pistas y el historial esperados", async () => {
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  const nombres = estado.socios.map((s: { nombre: string }) => s.nombre);
  for (const nombre of ["Irene Sanz", "Marta López", "Luis Martín"]) {
    assert.equal(nombres.filter((n: string) => n === nombre).length, 1, `${nombre} debe ser único`);
  }
  assert.deepEqual(estado.socios.filter((s: { rol: string }) => s.rol === "gestor").map((s: { id: string }) => s.id), ["socio-040"]);
  assert.equal(estado.reservas.filter((r: { socioId: string }) => r.socioId === "socio-041").length, 0, "Nora Benítez no tiene reservas");
  const octubre = await api.pedir("GET", "/api/reservas?desde=2026-10-01&hasta=2026-10-31&limite=1");
  assert.equal(octubre.cuerpo.total, 315);
  const jueves = await api.pedir("GET", "/api/disponibilidad?fecha=2026-11-19");
  const a1930 = Object.fromEntries(jueves.cuerpo.pistas.map((p: any) => [p.pistaId, p.franjas.find((f: any) => f.inicio.endsWith("19:30")).estado]));
  assert.deepEqual(a1930, { "pista-1": "reservada", "pista-2": "libre", "pista-3": "libre", "pista-4": "cerrada" });
});

test("reservar sigue las reglas del club", async () => {
  const creada = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-004", pistaId: "pista-2", inicio: "2026-11-21T16:30" } });
  assert.equal(creada.status, 201);
  assert.equal(creada.cuerpo.reserva.importe, 2800);
  const repetida = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-003", pistaId: "pista-2", inicio: "2026-11-21T16:30" } });
  assert.equal(repetida.status, 409);
  assert.equal(repetida.cuerpo.error.codigo, "FRANJA_NO_DISPONIBLE");
  const cerrada = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-003", pistaId: "pista-4", inicio: "2026-11-21T16:30" } });
  assert.equal(cerrada.cuerpo.error.codigo, "PISTA_CERRADA");
  const pasada = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-003", pistaId: "pista-2", inicio: "2026-11-18T09:00" } });
  assert.equal(pasada.cuerpo.error.codigo, "FRANJA_PASADA");
});

test("cancelar: gratis hasta 24 horas antes y, después, solo con forzar y penalización", async () => {
  const fuera = await api.pedir("POST", "/api/reservas/R-0520/cancelar");
  assert.equal(fuera.status, 409);
  assert.equal(fuera.cuerpo.error.codigo, "FUERA_DE_PLAZO");
  const forzada = await api.pedir("POST", "/api/reservas/R-0520/cancelar", { cuerpo: { forzar: true } });
  assert.equal(forzada.cuerpo.reserva.penalizacion, 1200);
  const nueva = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-003", pistaId: "pista-3", inicio: "2026-11-24T12:00" } });
  const gratis = await api.pedir("POST", `/api/reservas/${nueva.cuerpo.reserva.id}/cancelar`);
  assert.equal(gratis.cuerpo.reserva.estado, "cancelada");
  assert.equal(gratis.cuerpo.reserva.penalizacion, undefined);
});

test("la cabecera X-Socio identifica a quien llama", async () => {
  const desconocido = await api.pedir("GET", "/api/pistas", { socio: "socio-999" });
  assert.equal(desconocido.status, 401);
  assert.equal(desconocido.cuerpo.error.codigo, "NO_IDENTIFICADO");
  assert.equal((await api.pedir("GET", "/api/pistas", { socio: "socio-040" })).status, 200);
});

test("el reloj del club se puede mover en las pruebas", async () => {
  const otra = await arrancarApi({ AHORA: "2026-11-23T20:00" });
  try {
    const pasada = await otra.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-003", pistaId: "pista-2", inicio: "2026-11-23T19:30" } });
    assert.equal(pasada.cuerpo.error.codigo, "FRANJA_PASADA");
    assert.equal((await otra.pedir("POST", "/_reloj", { cuerpo: { ahora: "2026-11-23T08:00" } })).status, 200);
    const ahora = await otra.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-003", pistaId: "pista-2", inicio: "2026-11-23T19:30" } });
    assert.equal(ahora.status, 201);
  } finally {
    otra.cerrar();
  }
});
