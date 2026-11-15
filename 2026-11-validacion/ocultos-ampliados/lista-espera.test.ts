// Tests ampliados de lista-espera: un test por clase de defecto de comportamiento confirmado en la revisión a mano,
// para probarlo en todos los estados del encargo. Caja negra por la API, como los tests ocultos (mismas ayudas), con el
// reloj fijado a la hora de la semilla. Cada test arranca su propia API y no depende del orden.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

// ---- Ayudas: las de los tests ocultos, con el reloj fijado ----

const AHORA = "2026-11-18T10:00";
const GESTOR = "socio-040";
/** La semana siguiente a la de la semilla: franjas lejanas, a más de 24 horas de la hora del club. */
const LEJOS = ["2026-11-25T00:00", "2026-12-02T00:00"] as const;
const SOCIOS_DE_LA_SEMILLA = /^socio-0(0[1-9]|[1-3]\d|4[01])$/;

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

function prueba(nombre: string, cuerpo: (api: Api) => Promise<void>, timeout = 30_000) {
  test(nombre, { timeout }, async () => {
    const api = await arrancarApi({ AHORA, TZ: "UTC" });
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

/** Socios de la semilla con la cuota al día, rol socio y ninguna reserva futura. */
async function sociosLibres(api: Api, cuantos: number): Promise<string[]> {
  const estado = await estadoDelClub(api);
  const conFuturas = new Set(estado.reservas.filter((r: any) => r.estado === "confirmada" && r.inicio > estado.ahora).map((r: any) => r.socioId));
  const libres: string[] = estado.socios
    .filter((s: any) => SOCIOS_DE_LA_SEMILLA.test(s.id) && s.rol === "socio" && s.cuotaActiva === true && !conFuturas.has(s.id))
    .map((s: any) => s.id);
  assert.ok(libres.length >= cuantos, `hacen falta ${cuantos} socios libres y hay ${libres.length}`);
  return libres.slice(0, cuantos);
}

/** Socios de la semilla con la cuota al día y rol socio, tengan o no reservas. */
async function sociosConCuota(api: Api, salvo: string[]): Promise<string[]> {
  const estado = await estadoDelClub(api);
  return estado.socios
    .filter((s: any) => SOCIOS_DE_LA_SEMILLA.test(s.id) && s.rol === "socio" && s.cuotaActiva === true && !salvo.includes(s.id))
    .map((s: any) => s.id);
}

async function socioSinCuota(api: Api): Promise<string> {
  const estado = await estadoDelClub(api);
  const moroso = estado.socios.find((s: any) => SOCIOS_DE_LA_SEMILLA.test(s.id) && s.rol === "socio" && s.cuotaActiva === false);
  assert.ok(moroso, "la semilla tiene socios sin la cuota al día");
  return moroso.id;
}

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

async function ocupar(api: Api, titular: string, [desde, hasta]: readonly [string, string]): Promise<Ocupada> {
  const [franja] = await franjasLibres(api, desde, hasta);
  assert.ok(franja, `no quedan franjas libres entre ${desde} y ${hasta}`);
  const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: titular, pistaId: franja.pistaId, inicio: franja.inicio } });
  assert.equal(r.status, 201, `reservar ${franja.pistaId} ${franja.inicio} para ${titular}: ${r.texto}`);
  return { ...franja, reservaId: r.cuerpo.reserva.id, titular };
}

async function apuntar(api: Api, socio: string, franja: { pistaId: string; inicio: string }): Promise<any> {
  const r = await api.pedir("POST", "/api/esperas", { socio, cuerpo: { pistaId: franja.pistaId, inicio: franja.inicio } });
  assert.equal(r.status, 201, `apuntar a ${socio} a ${franja.pistaId} ${franja.inicio}: ${r.texto}`);
  assert.ok(r.cuerpo?.espera, `POST /api/esperas responde { espera }: ${r.texto}`);
  return r.cuerpo.espera;
}

function retirar(api: Api, socio: string | undefined, espera: any) {
  return api.pedir("DELETE", `/api/esperas/${espera.id}`, { socio });
}

function listaDeEsperas(cuerpo: any): any[] {
  if (Array.isArray(cuerpo)) return cuerpo;
  if (cuerpo && typeof cuerpo === "object") {
    if (Array.isArray(cuerpo.esperas)) return cuerpo.esperas;
    const listas = Object.values(cuerpo).filter(Array.isArray);
    if (listas.length === 1) return listas[0] as any[];
  }
  assert.fail(`GET /api/esperas no trae una lista de esperas: ${JSON.stringify(cuerpo)}`);
}

async function esperasActivas(api: Api, quien: string, de?: string): Promise<any[]> {
  const r = await api.pedir("GET", de ? `/api/esperas?socio=${de}` : "/api/esperas", { socio: quien });
  assert.equal(r.status, 200, `GET /api/esperas como ${quien}${de ? ` de ${de}` : ""}: ${r.texto}`);
  return listaDeEsperas(r.cuerpo);
}

async function posicionActual(api: Api, espera: any): Promise<number> {
  const actual = (await esperasActivas(api, espera.socioId)).find((e) => e.id === espera.id);
  assert.ok(actual, `la espera ${espera.id} debe seguir en GET /api/esperas de ${espera.socioId}`);
  return actual.posicion;
}

/** El estado guardado de una espera en /_estado (sin el registro ni las reservas). Si no se guarda ahí, el esperado. */
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
  if (estados.size === 0) return esperado;
  assert.equal(estados.size, 1, `la espera ${espera.id} debe estar en /_estado con un solo estado (encontrados: ${[...estados].join(", ")})`);
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

async function reservaAsignada(api: Api, cancelacion: { status: number; cuerpo: any; texto: string }): Promise<any> {
  assert.equal(cancelacion.status, 200, cancelacion.texto);
  const id = cancelacion.cuerpo.asignadaA;
  assert.ok(id !== undefined && id !== null, `cancelar debe responder asignadaA con el id de la reserva nueva: ${cancelacion.texto}`);
  assert.notEqual(id, cancelacion.cuerpo.reserva?.id, "asignadaA es otra reserva, no la cancelada");
  return obtenerReserva(api, id);
}

async function reservasDeLaFranja(api: Api, franja: { pistaId: string; inicio: string }): Promise<any[]> {
  const r = await api.pedir("GET", `/api/reservas?fecha=${franja.inicio.slice(0, 10)}&pista=${franja.pistaId}&limite=100`);
  assert.equal(r.status, 200, r.texto);
  return r.cuerpo.reservas.filter((x: any) => x.inicio === franja.inicio);
}

async function cambiarPista(api: Api, pistaId: string, estado: "operativa" | "cerrada") {
  const r = await api.pedir("PATCH", `/api/pistas/${pistaId}`, { socio: GESTOR, cuerpo: { estado } });
  assert.equal(r.status, 200, `PATCH /api/pistas/${pistaId} ${estado}: ${r.texto}`);
}

function camposDeReserva(r: any) {
  const campos = ["id", "socioId", "pistaId", "inicio", "fin", "estado", "importe", "notas", "penalizacion", "motivoCancelacion"];
  return Object.fromEntries(campos.filter((c) => r?.[c] !== undefined).map((c) => [c, r[c]]));
}

const esDeLaFranja = (franja: { pistaId: string; inicio: string }) => (e: any) => e.pistaId === franja.pistaId && e.inicio === franja.inicio;

// ---- Tests ----

prueba("X1 · apuntarse deja la espera a nombre de quien llama aunque el cuerpo traiga otro socioId (C1)", async (api) => {
  const [titular, a, b] = await sociosLibres(api, 3);
  const moroso = await socioSinCuota(api);
  const x = await ocupar(api, titular, LEJOS);
  const y = await ocupar(api, titular, LEJOS);
  // Un socio con la cuota al día manda el socioId de otro: la espera es suya o el campo se rechaza.
  const r = await api.pedir("POST", "/api/esperas", { socio: a, cuerpo: { pistaId: x.pistaId, inicio: x.inicio, socioId: b } });
  assert.ok(r.status === 201 || r.status === 400, `responde 201 para quien llama o rechaza el campo con 400: ${r.texto}`);
  if (r.status === 201) assert.equal(r.cuerpo.espera.socioId, a, "la espera es de quien llama");
  assert.ok(!(await esperasActivas(api, b)).some(esDeLaFranja(x)), "el socio del cuerpo no queda apuntado");
  // Un socio sin la cuota al día no puede apuntar a otro: cuenta su cuota, la de quien llama.
  const m = await api.pedir("POST", "/api/esperas", { socio: moroso, cuerpo: { pistaId: y.pistaId, inicio: y.inicio, socioId: b } });
  assert.ok((m.status === 409 && m.cuerpo?.error?.codigo === "CUOTA_INACTIVA") || m.status === 400, `quien llama no tiene la cuota al día: ${m.texto}`);
  assert.ok(!(await esperasActivas(api, b)).some(esDeLaFranja(y)), "el socio del cuerpo no queda apuntado");
});

prueba("X2 · un socio puede pedir sus propias esperas con ?socio=<su id> (C4)", async (api) => {
  const [titular, a] = await sociosLibres(api, 2);
  const x = await ocupar(api, titular, LEJOS);
  const ea = await apuntar(api, a, x);
  const vistas = await esperasActivas(api, a, a);
  assert.deepEqual(vistas.map((e) => e.id), [ea.id]);
  assert.equal(vistas[0].posicion, 1);
});

prueba("X3 · la posición y la asignación siguen el orden de llegada también con más de 10000 esperas creadas (C4)", async (api) => {
  const [titular, p, q] = await sociosLibres(api, 3);
  const testigo = await ocupar(api, titular, LEJOS);
  const rueda = await ocupar(api, titular, LEJOS);
  // Altas y retiradas en otra franja, en paralelo con varios socios, para que el contador de esperas crezca.
  const ciclistas = (await sociosConCuota(api, [titular, p, q])).slice(0, 8);
  assert.ok(ciclistas.length >= 4, "hacen falta socios para las altas y retiradas");
  const ciclos = (n: number) =>
    Promise.all(ciclistas.map(async (socio, i) => {
      const suyos = Math.floor(n / ciclistas.length) + (i < n % ciclistas.length ? 1 : 0);
      for (let k = 0; k < suyos; k++) {
        const e = await apuntar(api, socio, rueda);
        const d = await retirar(api, socio, e);
        assert.equal(d.status, 200, `retirar ${e.id}: ${d.texto}`);
      }
    }));
  await ciclos(8999);
  const ep = await apuntar(api, p, testigo); // la espera número 9000
  await ciclos(1999);
  const eq = await apuntar(api, q, testigo); // la espera número 11000
  assert.equal(eq.posicion, 2, "quien llega después va detrás");
  assert.equal(await posicionActual(api, ep), 1, "quien llegó antes sigue el primero");
  assert.equal(await posicionActual(api, eq), 2);
  const nueva = await reservaAsignada(api, await cancelar(api, testigo.reservaId));
  assert.equal(nueva.socioId, p, "la franja es para quien llegó antes");
}, 240_000);

prueba("X4 · cancelar con la pista cerrada no crea ninguna reserva en esa pista (C6)", async (api) => {
  const [titular, a] = await sociosLibres(api, 2);
  const x = await ocupar(api, titular, LEJOS);
  await apuntar(api, a, x);
  await cambiarPista(api, x.pistaId, "cerrada");
  const r = await cancelar(api, x.reservaId);
  const nuevas = (await reservasDeLaFranja(api, x)).filter((v) => v.estado === "confirmada" && v.id !== x.reservaId);
  assert.deepEqual(nuevas.map((v) => [v.id, v.socioId]), [], "no se crea ninguna reserva confirmada en la pista cerrada");
  const asignadaA = r.status === 200 ? r.cuerpo?.asignadaA : null;
  if (asignadaA !== null && asignadaA !== undefined) {
    const asignada = await api.pedir("GET", `/api/reservas/${asignadaA}`);
    const enPistaCerrada = asignada.status === 200 && asignada.cuerpo.reserva.estado === "confirmada" && asignada.cuerpo.reserva.pistaId === x.pistaId;
    assert.ok(!enPistaCerrada, `asignadaA no puede ser una reserva confirmada en la pista cerrada: ${asignada.texto}`);
  }
});

prueba("X5 · con lista de espera, cancelar una reserva de una pista cerrada responde 200 y la cancela, como sin lista (C9)", async (api) => {
  const [titular, a] = await sociosLibres(api, 2);
  const x = await ocupar(api, titular, LEJOS);
  const ea = await apuntar(api, a, x);
  await cambiarPista(api, x.pistaId, "cerrada");
  const antes = await obtenerReserva(api, x.reservaId);
  const r = await cancelar(api, x.reservaId);
  assert.equal(r.status, 200, `cancelar como sin lista: ${r.texto}`);
  assert.deepEqual(camposDeReserva(r.cuerpo.reserva), { ...camposDeReserva(antes), estado: "cancelada" });
  assert.ok("asignadaA" in r.cuerpo, `la respuesta trae asignadaA: ${r.texto}`);
  assert.equal((await obtenerReserva(api, x.reservaId)).estado, "cancelada");
  if (r.cuerpo.asignadaA === null) {
    assert.notEqual(await estadoGuardado(api, ea, "activa"), "asignada", "si no se crea ninguna reserva, la espera no pasa a asignada");
  }
});

prueba("X6 · quien reserva la franja que esperaba deja de esperarla y no se le reasigna al cancelarla (C3)", async (api) => {
  const [titular, a, b] = await sociosLibres(api, 3);
  const x = await ocupar(api, titular, LEJOS);
  await apuntar(api, a, x);
  await apuntar(api, b, x);
  // La franja queda libre sin asignarse si se cancela con la pista cerrada. Después se reabre.
  await cambiarPista(api, x.pistaId, "cerrada");
  await cancelar(api, x.reservaId);
  await cambiarPista(api, x.pistaId, "operativa");
  // a se queda la franja: la reserva directamente si está libre (si se le asignó, ya la tiene).
  await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: a, pistaId: x.pistaId, inicio: x.inicio } });
  const deA = (await reservasDeLaFranja(api, x)).find((v) => v.estado === "confirmada" && v.socioId === a);
  // Si a no llega a tener la franja, la situación del criterio 3 no se da y no hay nada que comprobar.
  if (!deA) return;
  assert.ok(!(await esperasActivas(api, a)).some(esDeLaFranja(x)), "quien tiene la franja reservada ya no la espera");
  const c = await cancelar(api, deA.id);
  assert.equal(c.status, 200, c.texto);
  if (c.cuerpo.asignadaA !== null && c.cuerpo.asignadaA !== undefined) {
    const nueva = await obtenerReserva(api, c.cuerpo.asignadaA);
    assert.notEqual(nueva.socioId, a, "la franja que cancela no vuelve a quien la cancela");
  }
});
