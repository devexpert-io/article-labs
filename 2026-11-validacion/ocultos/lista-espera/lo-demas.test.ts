// Tests ocultos de la spec lista-espera: lo demás no cambia y documentación (criterios 9 y 10).
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en
// test-ocultos/ dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test.
// Cada test empieza por el número de su criterio (C<n> · …).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

// ---- Ayudas comunes: son las mismas en todos los ficheros, porque el corrector solo copia ayuda.ts y los *.test.ts ----

const GESTOR = "socio-040";
const NOTA_ASIGNADA = "Asignada desde la lista de espera";
/** La semana siguiente a la de la semilla: franjas lejanas, a más de 24 horas de la hora del club (2026-11-18T10:00). */
const LEJOS = ["2026-11-25T00:00", "2026-12-02T00:00"] as const;
/** Las franjas que empiezan dentro de las 24 horas siguientes a la hora del club: cancelarlas exige forzar. */
const PRONTO = ["2026-11-18T10:01", "2026-11-19T10:00"] as const;

interface Franja {
  pistaId: string;
  inicio: string;
  precio: number;
}
interface Ocupada extends Franja {
  reservaId: string;
  titular: string;
}

const abiertas = new Set<Api>();
after(() => abiertas.forEach((api) => api.cerrar()));

/** Cada test arranca su propia API: no depende del orden ni de lo que cambien los demás. */
function prueba(nombre: string, cuerpo: (api: Api) => Promise<void>) {
  test(nombre, { timeout: 30_000 }, async () => {
    const api = await arrancarApi();
    abiertas.add(api);
    try {
      await cuerpo(api);
    } finally {
      api.cerrar();
      abiertas.delete(api);
    }
  });
}

function sumarMinutos(fechaHora: string, minutos: number): string {
  return new Date(Date.parse(`${fechaHora}:00Z`) + minutos * 60_000).toISOString().slice(0, 16);
}

async function estadoDelClub(api: Api): Promise<any> {
  const r = await api.pedir("GET", "/_estado");
  assert.equal(r.status, 200, "GET /_estado");
  return r.cuerpo;
}

async function moverReloj(api: Api, ahora: string) {
  const r = await api.pedir("POST", "/_reloj", { cuerpo: { ahora } });
  assert.equal(r.status, 200, `POST /_reloj ${ahora}`);
}

/** Socios de la semilla con la cuota al día, rol socio y ninguna reserva futura: pueden esperar y recibir franjas sin chocar con nada. */
async function sociosLibres(api: Api, cuantos: number, opciones: { conHistorial?: boolean } = {}): Promise<string[]> {
  const estado = await estadoDelClub(api);
  const confirmadas = estado.reservas.filter((r: any) => r.estado === "confirmada");
  const conFuturas = new Set(confirmadas.filter((r: any) => r.inicio > estado.ahora).map((r: any) => r.socioId));
  const conPasadas = new Set(confirmadas.filter((r: any) => r.inicio <= estado.ahora).map((r: any) => r.socioId));
  const libres: string[] = estado.socios
    .filter((s: any) => /^socio-0(0[1-9]|[1-3]\d|4[01])$/.test(s.id) && s.rol === "socio" && s.cuotaActiva === true)
    .filter((s: any) => !conFuturas.has(s.id) && (!opciones.conHistorial || conPasadas.has(s.id)))
    .map((s: any) => s.id);
  assert.ok(libres.length >= cuantos, `hacen falta ${cuantos} socios libres y hay ${libres.length}`);
  return libres.slice(0, cuantos);
}

/** Un socio de la semilla sin la cuota al día. */
async function socioSinCuota(api: Api): Promise<string> {
  const estado = await estadoDelClub(api);
  const moroso = estado.socios.find((s: any) => /^socio-0(0[1-9]|[1-3]\d|4[01])$/.test(s.id) && s.rol === "socio" && s.cuotaActiva === false);
  assert.ok(moroso, "la semilla tiene socios sin la cuota al día");
  return moroso.id;
}

/** Franjas libres de pistas operativas que empiezan entre `desde` (incluida) y `hasta` (excluida), por orden. */
async function franjasLibres(api: Api, desde: string, hasta: string): Promise<Franja[]> {
  const libres: Franja[] = [];
  for (let dia = desde.slice(0, 10); dia <= hasta.slice(0, 10); dia = sumarMinutos(`${dia}T12:00`, 24 * 60).slice(0, 10)) {
    const r = await api.pedir("GET", `/api/disponibilidad?fecha=${dia}`);
    assert.equal(r.status, 200, `disponibilidad del ${dia}`);
    for (const p of r.cuerpo.pistas) {
      if (p.estado !== "operativa") continue;
      for (const f of p.franjas) {
        if (f.estado === "libre" && f.inicio >= desde && f.inicio < hasta) libres.push({ pistaId: p.pistaId, inicio: f.inicio, precio: f.precio });
      }
    }
  }
  return libres.sort((a, b) => a.inicio.localeCompare(b.inicio) || a.pistaId.localeCompare(b.pistaId));
}

/** Reserva a nombre de `titular` la primera franja libre entre `desde` y `hasta`, para tener una franja ocupada que esperar. */
async function ocupar(api: Api, titular: string, [desde, hasta]: readonly [string, string]): Promise<Ocupada> {
  const [franja] = await franjasLibres(api, desde, hasta);
  assert.ok(franja, `no quedan franjas libres entre ${desde} y ${hasta}`);
  const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: titular, pistaId: franja.pistaId, inicio: franja.inicio } });
  assert.equal(r.status, 201, `reservar ${franja.pistaId} ${franja.inicio} para ${titular}: ${r.texto}`);
  return { ...franja, reservaId: r.cuerpo.reserva.id, titular };
}

function pedirEspera(api: Api, socio: string | undefined, franja: { pistaId: string; inicio: string }) {
  return api.pedir("POST", "/api/esperas", { socio, cuerpo: { pistaId: franja.pistaId, inicio: franja.inicio } });
}

/** Apunta a `socio` a la lista de espera de `franja` y comprueba que responde 201 { espera }. */
async function apuntar(api: Api, socio: string, franja: { pistaId: string; inicio: string }): Promise<any> {
  const r = await pedirEspera(api, socio, franja);
  assert.equal(r.status, 201, `apuntar a ${socio} a ${franja.pistaId} ${franja.inicio}: ${r.texto}`);
  assert.ok(r.cuerpo?.espera, `POST /api/esperas responde { espera }: ${r.texto}`);
  return r.cuerpo.espera;
}

function retirar(api: Api, socio: string | undefined, espera: any) {
  return api.pedir("DELETE", `/api/esperas/${espera.id}`, { socio });
}

/** La lista de una respuesta de GET /api/esperas. La spec no fija el envoltorio: vale { esperas: [...] }, otro objeto con una sola lista o la lista sola. */
function listaDeEsperas(cuerpo: any): any[] {
  if (Array.isArray(cuerpo)) return cuerpo;
  if (cuerpo && typeof cuerpo === "object") {
    if (Array.isArray(cuerpo.esperas)) return cuerpo.esperas;
    const listas = Object.values(cuerpo).filter(Array.isArray);
    if (listas.length === 1) return listas[0] as any[];
  }
  assert.fail(`GET /api/esperas no trae una lista de esperas: ${JSON.stringify(cuerpo)}`);
}

/** Las esperas activas que ve `quien` con GET /api/esperas: las suyas o, con `de`, las de otro socio. */
async function esperasActivas(api: Api, quien: string, de?: string): Promise<any[]> {
  const r = await api.pedir("GET", de ? `/api/esperas?socio=${de}` : "/api/esperas", { socio: quien });
  assert.equal(r.status, 200, `GET /api/esperas como ${quien}${de ? ` de ${de}` : ""}: ${r.texto}`);
  return listaDeEsperas(r.cuerpo);
}

/** Si una espera sigue en la lista de su dueño según GET /api/esperas. */
async function sigueEnLaLista(api: Api, espera: any): Promise<boolean> {
  return (await esperasActivas(api, espera.socioId)).some((e) => e.id === espera.id);
}

/** La posición actual de una espera según GET /api/esperas de su dueño. */
async function posicionActual(api: Api, espera: any): Promise<number> {
  const actual = (await esperasActivas(api, espera.socioId)).find((e) => e.id === espera.id);
  assert.ok(actual, `la espera ${espera.id} debe seguir en GET /api/esperas de ${espera.socioId}`);
  return actual.posicion;
}

/**
 * El estado guardado de una espera. Solo se ve en /_estado y la spec no dice dónde ni cómo se guarda, así que se busca
 * por id en todo el estado, sin contar el registro de operaciones ni las reservas (las que tienen importe). Si la
 * implementación no guarda las esperas en el estado, no se comprueba.
 */
async function estadoGuardado(api: Api, espera: any, esperado: string): Promise<string> {
  const { registro: _registro, ...club } = await estadoDelClub(api);
  const estados = new Set<string>();
  const visitar = (valor: unknown): void => {
    if (Array.isArray(valor)) return valor.forEach(visitar);
    if (!valor || typeof valor !== "object") return;
    const o = valor as Record<string, unknown>;
    if (o.id === espera.id && "estado" in o && !("importe" in o)) estados.add(String(o.estado));
    Object.values(o).forEach(visitar);
  };
  visitar(club);
  // La spec no obliga a guardar las esperas en /_estado: si no están, solo cuenta lo que se ve por la API.
  if (estados.size === 0) return esperado;
  assert.equal(estados.size, 1, `la espera ${espera.id} debe estar en /_estado con un solo estado (encontrados: ${[...estados].join(", ") || "ninguno"})`);
  return [...estados][0]!;
}

async function cancelar(api: Api, reservaId: string, cuerpo?: unknown) {
  return api.pedir("POST", `/api/reservas/${reservaId}/cancelar`, cuerpo === undefined ? {} : { cuerpo });
}

async function obtenerReserva(api: Api, id: string): Promise<any> {
  const r = await api.pedir("GET", `/api/reservas/${id}`);
  assert.equal(r.status, 200, `GET /api/reservas/${id}: ${r.texto}`);
  return r.cuerpo.reserva;
}

/** La reserva que dice `asignadaA` en la respuesta de cancelar: tiene que ser una reserva nueva. */
async function reservaAsignada(api: Api, cancelacion: { status: number; cuerpo: any; texto: string }): Promise<any> {
  assert.equal(cancelacion.status, 200, cancelacion.texto);
  const id = cancelacion.cuerpo.asignadaA;
  assert.ok(id !== undefined && id !== null, `cancelar debe responder asignadaA con el id de la reserva nueva: ${cancelacion.texto}`);
  assert.notEqual(id, cancelacion.cuerpo.reserva?.id, "asignadaA es otra reserva, no la cancelada");
  const reserva = await obtenerReserva(api, id);
  assert.equal(reserva.id, id);
  return reserva;
}

/** Las reservas (en cualquier estado) de una franja. */
async function reservasDeLaFranja(api: Api, franja: { pistaId: string; inicio: string }): Promise<any[]> {
  const r = await api.pedir("GET", `/api/reservas?fecha=${franja.inicio.slice(0, 10)}&pista=${franja.pistaId}&limite=100`);
  assert.equal(r.status, 200, r.texto);
  return r.cuerpo.reservas.filter((x: any) => x.inicio === franja.inicio);
}

/** El estado de una franja en GET /api/disponibilidad: libre, reservada o cerrada. */
async function estadoDeLaFranja(api: Api, franja: { pistaId: string; inicio: string }): Promise<string> {
  const r = await api.pedir("GET", `/api/disponibilidad?fecha=${franja.inicio.slice(0, 10)}&pista=${franja.pistaId}`);
  assert.equal(r.status, 200, r.texto);
  return r.cuerpo.pistas[0].franjas.find((f: any) => f.inicio === franja.inicio).estado;
}

async function reservasFuturas(api: Api, socioId: string): Promise<any[]> {
  const estado = await estadoDelClub(api);
  return estado.reservas.filter((r: any) => r.socioId === socioId && r.estado === "confirmada" && r.inicio > estado.ahora);
}

function esError(r: { status: number; cuerpo: any; texto: string }, http: number, codigo: string) {
  assert.equal(r.status, http, `se esperaba ${http} ${codigo}: ${r.texto}`);
  assert.equal(r.cuerpo?.error?.codigo, codigo, r.texto);
}

// ---- Tests ----

/** Los campos de una reserva en la base, sin los que no vienen. */
function camposDeReserva(r: any) {
  const campos = ["id", "socioId", "pistaId", "inicio", "fin", "estado", "importe", "notas", "penalizacion", "motivoCancelacion"];
  return Object.fromEntries(campos.filter((c) => r?.[c] !== undefined).map((c) => [c, r[c]]));
}

/** La reserva de la semilla que empieza dentro de 24 horas (Marta López, pista 3, jueves 19 a las 09:00: ver club/test/club.test.ts). */
const FUERA_DE_PLAZO = "R-0520";

prueba("C9 · la semilla y las consultas de siempre no cambian", async (api) => {
  const estado = await estadoDelClub(api);
  assert.deepEqual(estado.socios.filter((s: any) => s.rol === "gestor").map((s: any) => s.id), [GESTOR]);
  assert.equal(estado.reservas.filter((r: any) => r.socioId === "socio-041").length, 0);
  const octubre = await api.pedir("GET", "/api/reservas?desde=2026-10-01&hasta=2026-10-31&limite=1");
  assert.equal(octubre.status, 200);
  assert.equal(octubre.cuerpo.total, 315);
  const jueves = await api.pedir("GET", "/api/disponibilidad?fecha=2026-11-19");
  const a1930 = Object.fromEntries(jueves.cuerpo.pistas.map((p: any) => [p.pistaId, p.franjas.find((f: any) => f.inicio.endsWith("19:30")).estado]));
  assert.deepEqual(a1930, { "pista-1": "reservada", "pista-2": "libre", "pista-3": "libre", "pista-4": "cerrada" });
  esError(await api.pedir("GET", "/api/pistas", { socio: "socio-999" }), 401, "NO_IDENTIFICADO");
  assert.equal((await api.pedir("GET", "/api/pistas", { socio: GESTOR })).status, 200);
  assert.equal((await api.pedir("GET", "/api/pistas")).status, 200);
});

prueba("C9 · reservar sigue con sus reglas", async (api) => {
  const creada = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-004", pistaId: "pista-2", inicio: "2026-11-21T16:30" } });
  assert.equal(creada.status, 201, creada.texto);
  assert.deepEqual(camposDeReserva(creada.cuerpo.reserva), {
    id: creada.cuerpo.reserva.id, socioId: "socio-004", pistaId: "pista-2", inicio: "2026-11-21T16:30", fin: "2026-11-21T18:00",
    estado: "confirmada", importe: 2800, notas: "",
  });
  const reservar = (cuerpo: unknown) => api.pedir("POST", "/api/reservas", { cuerpo });
  esError(await reservar({ socioId: "socio-003", pistaId: "pista-2", inicio: "2026-11-21T16:30" }), 409, "FRANJA_NO_DISPONIBLE");
  esError(await reservar({ socioId: "socio-003", pistaId: "pista-4", inicio: "2026-11-21T16:30" }), 409, "PISTA_CERRADA");
  esError(await reservar({ socioId: "socio-003", pistaId: "pista-2", inicio: "2026-11-18T09:00" }), 409, "FRANJA_PASADA");
  esError(await reservar({ socioId: "socio-999", pistaId: "pista-2", inicio: "2026-11-25T12:00" }), 404, "SOCIO_NO_ENCONTRADO");
  esError(await reservar({ socioId: "socio-003", pistaId: "pista-99", inicio: "2026-11-25T12:00" }), 404, "PISTA_NO_ENCONTRADA");
  esError(await reservar({ socioId: "socio-003", pistaId: "pista-2", inicio: "2026-11-25T12:15" }), 400, "FRANJA_INVALIDA");
  esError(await reservar({ socioId: "socio-003" }), 400, "DATOS_INVALIDOS");
  const [libre] = await franjasLibres(api, ...LEJOS);
  assert.ok(libre, "hay franjas libres");
  esError(await reservar({ socioId: await socioSinCuota(api), pistaId: libre.pistaId, inicio: libre.inicio }), 409, "CUOTA_INACTIVA");
  const [socio] = await sociosLibres(api, 1);
  for (let i = 0; i < 3; i++) await ocupar(api, socio, LEJOS);
  const [otra] = await franjasLibres(api, ...LEJOS);
  assert.ok(otra, "hay franjas libres");
  esError(await reservar({ socioId: socio, pistaId: otra.pistaId, inicio: otra.inicio }), 409, "LIMITE_DE_RESERVAS");
});

prueba("C9 · cancelar sigue con sus plazos y sus penalizaciones", async (api) => {
  const antes = await obtenerReserva(api, FUERA_DE_PLAZO);
  esError(await cancelar(api, FUERA_DE_PLAZO), 409, "FUERA_DE_PLAZO");
  esError(await cancelar(api, FUERA_DE_PLAZO, { forzar: "sí" }), 400, "DATOS_INVALIDOS");
  assert.equal((await obtenerReserva(api, FUERA_DE_PLAZO)).estado, "confirmada");
  const forzada = await cancelar(api, FUERA_DE_PLAZO, { forzar: true, motivo: "Lesión" });
  assert.equal(forzada.status, 200, forzada.texto);
  assert.deepEqual(camposDeReserva(forzada.cuerpo.reserva), {
    ...camposDeReserva(antes), estado: "cancelada", penalizacion: 1200, motivoCancelacion: "Lesión",
  });
  esError(await cancelar(api, FUERA_DE_PLAZO, { forzar: true }), 409, "YA_CANCELADA");
  esError(await cancelar(api, "R-9999"), 404, "RESERVA_NO_ENCONTRADA");

  const nueva = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-003", pistaId: "pista-3", inicio: "2026-11-24T12:00" } });
  assert.equal(nueva.status, 201, nueva.texto);
  const gratis = await cancelar(api, nueva.cuerpo.reserva.id);
  assert.equal(gratis.status, 200, gratis.texto);
  assert.deepEqual(camposDeReserva(gratis.cuerpo.reserva), { ...camposDeReserva(nueva.cuerpo.reserva), estado: "cancelada" });

  const [titular] = await sociosLibres(api, 1);
  const x = await ocupar(api, titular, LEJOS);
  await moverReloj(api, x.inicio);
  esError(await cancelar(api, x.reservaId, { forzar: true }), 409, "RESERVA_PASADA");
});

prueba("C9 · cancelar una franja sin lista de espera responde como antes, más asignadaA: null", async (api) => {
  const [titular] = await sociosLibres(api, 1);
  const x = await ocupar(api, titular, LEJOS);
  const antesX = await obtenerReserva(api, x.reservaId);
  const gratis = await cancelar(api, x.reservaId, { motivo: "Viaje" });
  assert.equal(gratis.status, 200, gratis.texto);
  assert.deepEqual(camposDeReserva(gratis.cuerpo.reserva), { ...camposDeReserva(antesX), estado: "cancelada", motivoCancelacion: "Viaje" });
  assert.ok("asignadaA" in gratis.cuerpo, `la respuesta trae asignadaA: ${gratis.texto}`);
  assert.equal(gratis.cuerpo.asignadaA, null);

  const antes = await obtenerReserva(api, FUERA_DE_PLAZO);
  const forzada = await cancelar(api, FUERA_DE_PLAZO, { forzar: true });
  assert.equal(forzada.status, 200, forzada.texto);
  assert.deepEqual(camposDeReserva(forzada.cuerpo.reserva), { ...camposDeReserva(antes), estado: "cancelada", penalizacion: antes.importe });
  assert.ok("asignadaA" in forzada.cuerpo, `la respuesta trae asignadaA: ${forzada.texto}`);
  assert.equal(forzada.cuerpo.asignadaA, null);
});

// En los dos siguientes la lista de espera se prepara sin comprobar la respuesta: sin la feature (en la base) tienen que pasar igual.

prueba("C9 · con lista de espera, cancelar con forzar sigue cobrando la penalización a quien cancela", async (api) => {
  const [titular, a] = await sociosLibres(api, 2);
  const x = await ocupar(api, titular, PRONTO);
  await pedirEspera(api, a, x);
  const antes = await obtenerReserva(api, x.reservaId);
  const r = await cancelar(api, x.reservaId, { forzar: true });
  assert.equal(r.status, 200, r.texto);
  assert.deepEqual(camposDeReserva(r.cuerpo.reserva), { ...camposDeReserva(antes), estado: "cancelada", penalizacion: antes.importe });
});

prueba("C9 · con lista de espera, una cancelación rechazada no asigna nada", async (api) => {
  const [titular, a, b] = await sociosLibres(api, 3);
  const pronto = await ocupar(api, titular, PRONTO);
  await pedirEspera(api, a, pronto);
  esError(await cancelar(api, pronto.reservaId), 409, "FUERA_DE_PLAZO");
  const dePronto = await reservasDeLaFranja(api, pronto);
  assert.deepEqual(dePronto.filter((r) => r.estado === "confirmada").map((r) => [r.id, r.socioId]), [[pronto.reservaId, titular]]);
  assert.ok(!dePronto.some((r) => r.socioId === a), "quien espera no recibe la franja si la cancelación no sale");

  const x = await ocupar(api, titular, LEJOS);
  await pedirEspera(api, a, x);
  await pedirEspera(api, b, x);
  assert.equal((await cancelar(api, x.reservaId)).status, 200);
  esError(await cancelar(api, x.reservaId), 409, "YA_CANCELADA");
  const confirmadas = (await reservasDeLaFranja(api, x)).filter((r) => r.estado === "confirmada");
  assert.ok(confirmadas.length <= 1, "la franja no se asigna dos veces");
  assert.ok(!confirmadas.some((r) => r.socioId === b), "el segundo de la lista no recibe la franja");
});

/** El README.md de la implementación (los tests se copian en test-ocultos/, dentro de ella). */
function leerReadme(): string {
  return readFileSync(new URL("../README.md", import.meta.url), "utf8");
}

test("C10 · el README documenta la ruta /api/esperas", () => {
  assert.ok(leerReadme().includes("/api/esperas"), "el README menciona /api/esperas");
});

test("C10 · el README documenta el campo asignadaA de cancelar", () => {
  assert.ok(leerReadme().includes("asignadaA"), "el README menciona asignadaA");
});

test("C10 · el README documenta los errores nuevos", () => {
  const readme = leerReadme();
  const faltan = ["FRANJA_LIBRE", "YA_EN_ESPERA", "YA_RESERVADA", "LIMITE_DE_ESPERAS", "ESPERA_NO_ENCONTRADA", "SIN_PERMISO"].filter((c) => !readme.includes(c));
  assert.deepEqual(faltan, [], `faltan en el README: ${faltan.join(", ")}`);
});
