// Tests ocultos de la spec codigos-descuento: los importes guardados (C7) y la penalización con descuento (C9).
// Caja negra: solo la API HTTP, /_estado y /_reloj. Cada test arranca su propia API.
import assert from "node:assert/strict";
import { test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

async function conApi(prueba: (api: Api) => Promise<void>, ahora?: string): Promise<void> {
  const api = await arrancarApi();
  try {
    if (ahora) assert.equal((await api.pedir("POST", "/_reloj", { cuerpo: { ahora } })).status, 200, "POST /_reloj");
    await prueba(api);
  } finally {
    api.cerrar();
  }
}

const reservar = (api: Api, cuerpo: Record<string, unknown>) => api.pedir("POST", "/api/reservas", { cuerpo });
const mover = async (api: Api, ahora: string) =>
  assert.equal((await api.pedir("POST", "/_reloj", { cuerpo: { ahora } })).status, 200, "POST /_reloj");
const cancelar = (api: Api, id: string, cuerpo?: Record<string, unknown>) =>
  api.pedir("POST", `/api/reservas/${id}/cancelar`, { cuerpo });

function error(r: Respuesta, http: number, codigo: string, contexto = ""): void {
  assert.equal(r.status, http, `${contexto} ${r.texto}`);
  assert.equal(r.cuerpo?.error?.codigo, codigo, `${contexto} ${r.texto}`);
}

function importes(reserva: any) {
  return { importeBase: reserva?.importeBase, descuento: reserva?.descuento, importe: reserva?.importe, codigo: reserva?.codigo };
}

async function sociosLibres(api: Api, cuantos: number): Promise<string[]> {
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  const ids = estado.socios
    .filter((s: any) => s.cuotaActiva === true && s.id !== "socio-040" && s.id !== "socio-041")
    .filter((s: any) => !estado.reservas.some((r: any) => r.socioId === s.id && r.estado === "confirmada" && r.inicio > estado.ahora))
    .map((s: any) => s.id);
  assert.ok(ids.length >= cuantos, `hacen falta ${cuantos} socios con la cuota al día`);
  return ids.slice(0, cuantos);
}

// Lunes 7 de diciembre de 2026, antes de la primera franja: no hay reservas en la semilla.
const DICIEMBRE = "2026-12-07T08:00";

test("C7 · POST y GET /api/reservas/:id devuelven importeBase, descuento, importe y codigo", () =>
  conApi(async (api) => {
    const [a] = await sociosLibres(api, 1);
    const casos = [
      { pistaId: "pista-1", inicio: "2026-12-12T18:00", esperado: { importeBase: 2800, descuento: 280, importe: 2520, codigo: "CLUB10" } },
      { pistaId: "pista-3", inicio: "2026-12-07T13:30", esperado: { importeBase: 1200, descuento: 120, importe: 1080, codigo: "CLUB10" } },
    ];
    for (const { pistaId, inicio, esperado } of casos) {
      const r = await reservar(api, { socioId: a, pistaId, inicio, codigo: "CLUB10" });
      assert.equal(r.status, 201, r.texto);
      assert.deepEqual(importes(r.cuerpo.reserva), esperado, `POST ${inicio}`);
      const leida = await api.pedir("GET", `/api/reservas/${r.cuerpo.reserva.id}`);
      assert.equal(leida.status, 200, leida.texto);
      assert.deepEqual(importes(leida.cuerpo.reserva), esperado, `GET ${inicio}`);
    }
  }, DICIEMBRE));

test("C7 · GET /api/reservas devuelve importeBase, descuento, importe y codigo", () =>
  conApi(async (api) => {
    const [a] = await sociosLibres(api, 1);
    const conCodigo = await reservar(api, { socioId: a, pistaId: "pista-1", inicio: "2026-12-12T18:00", codigo: "CLUB10" });
    assert.equal(conCodigo.status, 201, conCodigo.texto);
    const sinCodigo = await reservar(api, { socioId: a, pistaId: "pista-2", inicio: "2026-12-12T19:30" });
    assert.equal(sinCodigo.status, 201, sinCodigo.texto);
    const lista = await api.pedir("GET", `/api/reservas?socio=${a}&fecha=2026-12-12`);
    assert.equal(lista.status, 200, lista.texto);
    const porId = (id: string) => lista.cuerpo.reservas.find((r: any) => r.id === id);
    assert.deepEqual(importes(porId(conCodigo.cuerpo.reserva.id)), { importeBase: 2800, descuento: 280, importe: 2520, codigo: "CLUB10" });
    assert.deepEqual(importes(porId(sinCodigo.cuerpo.reserva.id)), { importeBase: 2800, descuento: 0, importe: 2800, codigo: undefined });
    assert.equal("codigo" in porId(sinCodigo.cuerpo.reserva.id), false, "sin código, la reserva no lleva codigo");
  }, DICIEMBRE));

test("C9 · la penalización por cancelar fuera de plazo es el importe con descuento", () =>
  conApi(async (api) => {
    const [a] = await sociosLibres(api, 1);
    // Martes 8 de diciembre: a las 18:00 (punta, 28,00 €) y a las 13:30 en la pista 3 (valle, 12,00 €).
    // Con CLUB10, el socio paga 25,20 € y 10,80 €.
    const punta = (await reservar(api, { socioId: a, pistaId: "pista-1", inicio: "2026-12-08T18:00", codigo: "CLUB10" })).cuerpo.reserva;
    const valle = (await reservar(api, { socioId: a, pistaId: "pista-3", inicio: "2026-12-08T13:30", codigo: "CLUB10" })).cuerpo.reserva;
    // A las 10:00 del martes ya no se cancela gratis.
    await mover(api, "2026-12-08T10:00");
    for (const [reserva, penalizacion] of [[punta, 2520], [valle, 1080]] as const) {
      error(await cancelar(api, reserva.id), 409, "FUERA_DE_PLAZO");
      const forzada = await cancelar(api, reserva.id, { forzar: true });
      assert.equal(forzada.status, 200, forzada.texto);
      assert.equal(forzada.cuerpo.reserva.estado, "cancelada");
      assert.equal(forzada.cuerpo.reserva.penalizacion, penalizacion);
      assert.equal((await api.pedir("GET", `/api/reservas/${reserva.id}`)).cuerpo.reserva.penalizacion, penalizacion);
    }
  }, DICIEMBRE));

test("C9 · sin código, la penalización sigue siendo el importe completo", () =>
  conApi(async (api) => {
    // Como en club/test/club.test.ts: R-0520 está a menos de 24 horas y su penalización es de 12,00 €.
    error(await cancelar(api, "R-0520"), 409, "FUERA_DE_PLAZO");
    const r0520 = await cancelar(api, "R-0520", { forzar: true });
    assert.equal(r0520.status, 200, r0520.texto);
    assert.equal(r0520.cuerpo.reserva.penalizacion, 1200);
    // Una reserva nueva sin código: jueves 19 a las 19:30 en la pista 3 (punta, 20,00 €).
    const nueva = await reservar(api, { socioId: "socio-003", pistaId: "pista-3", inicio: "2026-11-19T19:30" });
    assert.equal(nueva.status, 201, nueva.texto);
    await mover(api, "2026-11-19T10:00");
    const forzada = await cancelar(api, nueva.cuerpo.reserva.id, { forzar: true });
    assert.equal(forzada.status, 200, forzada.texto);
    assert.equal(forzada.cuerpo.reserva.penalizacion, 2000);
  }));
