// Tests ocultos de la spec lista-espera: consultar las esperas y retirarse (criterios 4 y 5).
// Caja negra: solo la API HTTP, más /_estado y /_reloj para preparar o comprobar. El corrector los copia en
// test-ocultos/ dentro de la implementación, junto a ayuda.ts, y los ejecuta desde su raíz con node --test.
// Cada test empieza por el número de su criterio (C<n> · …).
import assert from "node:assert/strict";
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

/** Un id con la misma forma que `id` que no es de ninguna espera. */
function idQueNoExiste(id: string | number): string {
  if (typeof id === "number") return String(id + 100_000);
  const numero = /^(.*?)(\d+)$/.exec(id);
  return numero ? `${numero[1]}${Number(numero[2]) + 100_000}` : `${id}-no-existe`;
}

prueba("C4 · la posición es el orden de llegada en la lista de cada franja, empezando por 1", async (api) => {
  const [titular, a, b, c] = await sociosLibres(api, 4);
  const x = await ocupar(api, titular, LEJOS);
  const y = await ocupar(api, titular, LEJOS);
  assert.equal((await apuntar(api, a, x)).posicion, 1);
  assert.equal((await apuntar(api, b, x)).posicion, 2);
  assert.equal((await apuntar(api, c, x)).posicion, 3);
  assert.equal((await apuntar(api, c, y)).posicion, 1);
  assert.equal((await apuntar(api, a, y)).posicion, 2);
});

prueba("C4 · GET /api/esperas devuelve las esperas activas de quien llama con su posición actual", async (api) => {
  const [titular, a, b] = await sociosLibres(api, 3);
  const x = await ocupar(api, titular, LEJOS);
  const y = await ocupar(api, titular, LEJOS);
  const ax = await apuntar(api, a, x);
  const bx = await apuntar(api, b, x);
  const by = await apuntar(api, b, y);
  const ay = await apuntar(api, a, y);
  const esperadas = new Map([[ax.id, { franja: x, posicion: 1 }], [ay.id, { franja: y, posicion: 2 }], [bx.id, { franja: x, posicion: 2 }], [by.id, { franja: y, posicion: 1 }]]);
  for (const [socio, suyas] of [[a, [ax.id, ay.id]], [b, [bx.id, by.id]]] as const) {
    const lista = await esperasActivas(api, socio);
    assert.equal(lista.length, 2, `${socio} tiene 2 esperas activas`);
    assert.deepEqual(new Set(lista.map((e) => e.id)), new Set(suyas));
    for (const e of lista) {
      const { franja, posicion } = esperadas.get(e.id)!;
      assert.equal(e.socioId, socio);
      assert.equal(e.pistaId, franja.pistaId);
      assert.equal(e.inicio, franja.inicio);
      assert.equal(e.estado, "activa");
      assert.equal(e.posicion, posicion, `posición de ${socio} en ${franja.pistaId} ${franja.inicio}`);
    }
  }
});

prueba("C4 · un gestor pide con ?socio= las esperas activas de otro socio, con su posición", async (api) => {
  const [titular, a, b] = await sociosLibres(api, 3);
  const x = await ocupar(api, titular, LEJOS);
  const y = await ocupar(api, titular, LEJOS);
  await apuntar(api, b, x);
  const ax = await apuntar(api, a, x);
  const ay = await apuntar(api, a, y);
  const vistas = await esperasActivas(api, GESTOR, a);
  assert.equal(vistas.length, 2);
  assert.equal(vistas.find((e) => e.id === ax.id)?.posicion, 2);
  assert.equal(vistas.find((e) => e.id === ay.id)?.posicion, 1);
  assert.ok(vistas.every((e) => e.socioId === a && e.estado === "activa"));
});

prueba("C4 · sin ?socio, un gestor ve solo sus propias esperas", async (api) => {
  const [titular, a] = await sociosLibres(api, 2);
  const x = await ocupar(api, titular, LEJOS);
  const ax = await apuntar(api, a, x);
  const delGestor = await esperasActivas(api, GESTOR);
  assert.ok(!delGestor.some((e) => e.id === ax.id), "la espera de otro socio no sale sin ?socio");
  assert.ok(delGestor.every((e) => e.socioId === GESTOR));
});

prueba("C4 · GET /api/esperas sin X-Socio responde 401 NO_IDENTIFICADO", async (api) => {
  esError(await api.pedir("GET", "/api/esperas"), 401, "NO_IDENTIFICADO");
});

prueba("C5 · retirarse responde 200 con la espera en retirada, y deja de estar en la lista", async (api) => {
  const [titular, a] = await sociosLibres(api, 2);
  const x = await ocupar(api, titular, LEJOS);
  const espera = await apuntar(api, a, x);
  const r = await retirar(api, a, espera);
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.cuerpo.espera.id, espera.id);
  assert.equal(r.cuerpo.espera.socioId, a);
  assert.equal(r.cuerpo.espera.pistaId, x.pistaId);
  assert.equal(r.cuerpo.espera.inicio, x.inicio);
  assert.equal(r.cuerpo.espera.estado, "retirada");
  assert.equal(await sigueEnLaLista(api, espera), false);
});

prueba("C5 · al retirarse, los que estaban detrás suben un puesto", async (api) => {
  const [titular, a, b, c, d] = await sociosLibres(api, 5);
  const x = await ocupar(api, titular, LEJOS);
  const ea = await apuntar(api, a, x);
  const eb = await apuntar(api, b, x);
  const ec = await apuntar(api, c, x);
  assert.equal((await retirar(api, b, eb)).status, 200);
  assert.equal(await posicionActual(api, ea), 1, "quien iba delante no se mueve");
  assert.equal(await posicionActual(api, ec), 2, "quien iba detrás sube un puesto");
  const ed = await apuntar(api, d, x);
  assert.equal(ed.posicion, 3, "el siguiente en llegar va detrás de los activos");
  assert.equal((await retirar(api, a, ea)).status, 200);
  assert.equal(await posicionActual(api, ec), 1);
  assert.equal(await posicionActual(api, ed), 2);
});

prueba("C5 · un socio no puede retirar la espera de otro: 403 SIN_PERMISO", async (api) => {
  const [titular, a, b] = await sociosLibres(api, 3);
  const x = await ocupar(api, titular, LEJOS);
  const ea = await apuntar(api, a, x);
  await apuntar(api, b, x);
  esError(await retirar(api, b, ea), 403, "SIN_PERMISO");
  assert.equal(await posicionActual(api, ea), 1, "la espera sigue activa y en su puesto");
});

prueba("C5 · un gestor puede retirar la espera de cualquier socio", async (api) => {
  const [titular, a] = await sociosLibres(api, 2);
  const x = await ocupar(api, titular, LEJOS);
  const ea = await apuntar(api, a, x);
  const r = await retirar(api, GESTOR, ea);
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.cuerpo.espera.id, ea.id);
  assert.equal(r.cuerpo.espera.estado, "retirada");
  assert.equal(await sigueEnLaLista(api, ea), false);
});

prueba("C5 · retirar una espera que no existe responde 404 ESPERA_NO_ENCONTRADA", async (api) => {
  const [titular, a] = await sociosLibres(api, 2);
  const x = await ocupar(api, titular, LEJOS);
  const ea = await apuntar(api, a, x);
  esError(await retirar(api, a, { id: idQueNoExiste(ea.id) }), 404, "ESPERA_NO_ENCONTRADA");
  esError(await retirar(api, GESTOR, { id: idQueNoExiste(ea.id) }), 404, "ESPERA_NO_ENCONTRADA");
});

prueba("C5 · retirar sin X-Socio responde 401 NO_IDENTIFICADO", async (api) => {
  const [titular, a] = await sociosLibres(api, 2);
  const x = await ocupar(api, titular, LEJOS);
  const ea = await apuntar(api, a, x);
  esError(await retirar(api, undefined, ea), 401, "NO_IDENTIFICADO");
  assert.equal(await posicionActual(api, ea), 1, "la espera sigue activa");
});
