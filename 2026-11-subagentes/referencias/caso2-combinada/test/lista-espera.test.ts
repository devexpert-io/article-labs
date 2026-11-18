// La lista de espera de franjas (docs/specs/lista-espera.md), probada a través de la API.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { arrancarApi, type Api, type Respuesta } from "./ayuda.ts";

const GESTOR = "socio-040";
/** Nora Benítez: sin ninguna reserva. Ocupa las franjas que esperan los demás. */
const TITULAR = "socio-041";
/** Socios de la semilla con la cuota al día y sin reservas futuras. */
const [ANA, BEA, CARLOS, DANI] = ["socio-006", "socio-016", "socio-020", "socio-023"] as const;
/** Sin la cuota al día. */
const MOROSO = "socio-011";
const NOTA = "Asignada desde la lista de espera";

/** Cada test arranca su propia API, con la semilla recién hecha. */
function prueba(nombre: string, cuerpo: (api: Api) => Promise<void>) {
  test(nombre, async () => {
    const api = await arrancarApi();
    try {
      await cuerpo(api);
    } finally {
      api.cerrar();
    }
  });
}

/** Franjas de la semana siguiente a la de la semilla: libres y a más de 24 horas. */
const franja = (pistaId: string, dia: number, hora: string) => ({ pistaId, inicio: `2026-11-${dia}T${hora}` });
type Franja = ReturnType<typeof franja>;

async function reservar(api: Api, socioId: string, f: Franja): Promise<any> {
  const r = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId, ...f } });
  assert.equal(r.status, 201, r.texto);
  return r.cuerpo.reserva;
}

const pedirEspera = (api: Api, socio: string | undefined, f: Franja) => api.pedir("POST", "/api/esperas", { socio, cuerpo: f });

async function apuntar(api: Api, socio: string, f: Franja): Promise<any> {
  const r = await pedirEspera(api, socio, f);
  assert.equal(r.status, 201, r.texto);
  return r.cuerpo.espera;
}

async function esperasDe(api: Api, quien: string, de?: string): Promise<any[]> {
  const r = await api.pedir("GET", de ? `/api/esperas?socio=${de}` : "/api/esperas", { socio: quien });
  assert.equal(r.status, 200, r.texto);
  return r.cuerpo.esperas;
}

async function posicion(api: Api, espera: any): Promise<number | undefined> {
  return (await esperasDe(api, espera.socioId)).find((e) => e.id === espera.id)?.posicion;
}

async function estadoGuardado(api: Api, espera: any): Promise<string> {
  return (await api.pedir("GET", "/_estado")).cuerpo.esperas.find((e: any) => e.id === espera.id).estado;
}

function error(r: Respuesta, http: number, codigo: string) {
  assert.equal(r.status, http, r.texto);
  assert.equal(r.cuerpo.error.codigo, codigo);
}

prueba("apuntarse a una franja ocupada responde 201 con la espera activa y su posición, y exige X-Socio", async (api) => {
  const x = franja("pista-1", 25, "18:00");
  await reservar(api, TITULAR, x);
  const r = await pedirEspera(api, ANA, x);
  assert.equal(r.status, 201);
  assert.deepEqual(r.cuerpo.espera, { id: r.cuerpo.espera.id, socioId: ANA, ...x, estado: "activa", posicion: 1 });
  error(await pedirEspera(api, undefined, x), 401, "NO_IDENTIFICADO");
  error(await pedirEspera(api, "socio-999", x), 401, "NO_IDENTIFICADO");
});

prueba("solo se esperan franjas ocupadas que se podrían reservar", async (api) => {
  const x = franja("pista-2", 25, "19:30");
  await reservar(api, TITULAR, x);
  error(await pedirEspera(api, ANA, franja("pista-3", 25, "19:30")), 409, "FRANJA_LIBRE");
  error(await pedirEspera(api, ANA, { ...x, pistaId: "pista-9" }), 404, "PISTA_NO_ENCONTRADA");
  error(await pedirEspera(api, ANA, { ...x, inicio: "2026-11-25T19:00" }), 400, "FRANJA_INVALIDA");
  error(await pedirEspera(api, MOROSO, x), 409, "CUOTA_INACTIVA");
  error(await pedirEspera(api, ANA, franja("pista-4", 25, "19:30")), 409, "PISTA_CERRADA");
  assert.equal((await api.pedir("PATCH", "/api/pistas/pista-2", { cuerpo: { estado: "cerrada" } })).status, 200);
  error(await pedirEspera(api, ANA, x), 409, "PISTA_CERRADA");
  assert.equal((await api.pedir("PATCH", "/api/pistas/pista-2", { cuerpo: { estado: "operativa" } })).status, 200);
  await api.pedir("POST", "/_reloj", { cuerpo: { ahora: x.inicio } });
  error(await pedirEspera(api, ANA, x), 409, "FRANJA_PASADA");
});

prueba("nadie está dos veces en la misma lista ni espera su propia reserva, y cada socio tiene como mucho 2 esperas activas", async (api) => {
  const [x, y, z] = [franja("pista-1", 26, "18:00"), franja("pista-2", 26, "18:00"), franja("pista-3", 26, "18:00")];
  for (const f of [x, y, z]) await reservar(api, TITULAR, f);
  const ex = await apuntar(api, ANA, x);
  error(await pedirEspera(api, ANA, x), 409, "YA_EN_ESPERA");
  error(await pedirEspera(api, TITULAR, x), 409, "YA_RESERVADA");
  await apuntar(api, ANA, y);
  error(await pedirEspera(api, ANA, z), 409, "LIMITE_DE_ESPERAS");
  assert.equal((await api.pedir("DELETE", `/api/esperas/${ex.id}`, { socio: ANA })).status, 200);
  await apuntar(api, ANA, z);
});

prueba("la posición es el orden de llegada y GET /api/esperas da las esperas activas de quien llama", async (api) => {
  const [x, y] = [franja("pista-1", 27, "18:00"), franja("pista-2", 27, "18:00")];
  for (const f of [x, y]) await reservar(api, TITULAR, f);
  const ax = await apuntar(api, ANA, x);
  const bx = await apuntar(api, BEA, x);
  const by = await apuntar(api, BEA, y);
  const ay = await apuntar(api, ANA, y);
  assert.deepEqual([ax.posicion, bx.posicion, by.posicion, ay.posicion], [1, 2, 1, 2]);
  const deAna = await esperasDe(api, ANA);
  assert.deepEqual(deAna.map((e) => [e.id, e.posicion]), [[ax.id, 1], [ay.id, 2]]);
  assert.deepEqual(await esperasDe(api, GESTOR, ANA), deAna);
  assert.deepEqual(await esperasDe(api, GESTOR), [], "sin ?socio, el gestor ve solo las suyas");
  error(await api.pedir("GET", `/api/esperas?socio=${ANA}`, { socio: BEA }), 403, "SIN_PERMISO");
  error(await api.pedir("GET", "/api/esperas"), 401, "NO_IDENTIFICADO");
});

prueba("retirarse deja la espera en retirada y los de detrás suben un puesto, y solo pueden hacerlo su dueño o un gestor", async (api) => {
  const x = franja("pista-3", 27, "21:00");
  await reservar(api, TITULAR, x);
  const [ea, eb, ec, ed] = [await apuntar(api, ANA, x), await apuntar(api, BEA, x), await apuntar(api, CARLOS, x), await apuntar(api, DANI, x)];
  error(await api.pedir("DELETE", `/api/esperas/${eb.id}`, { socio: ANA }), 403, "SIN_PERMISO");
  error(await api.pedir("DELETE", `/api/esperas/${eb.id}`), 401, "NO_IDENTIFICADO");
  error(await api.pedir("DELETE", "/api/esperas/E-9999", { socio: ANA }), 404, "ESPERA_NO_ENCONTRADA");
  const retirada = await api.pedir("DELETE", `/api/esperas/${eb.id}`, { socio: BEA });
  assert.equal(retirada.status, 200);
  assert.deepEqual(retirada.cuerpo.espera, { id: eb.id, socioId: BEA, ...x, estado: "retirada" });
  assert.deepEqual([await posicion(api, ea), await posicion(api, eb), await posicion(api, ec), await posicion(api, ed)], [1, undefined, 2, 3]);
  assert.equal((await api.pedir("DELETE", `/api/esperas/${ea.id}`, { socio: GESTOR })).cuerpo.espera.estado, "retirada");
  assert.deepEqual([await posicion(api, ec), await posicion(api, ed)], [1, 2]);
  error(await api.pedir("DELETE", `/api/esperas/${ea.id}`, { socio: ANA }), 409, "ESPERA_NO_ACTIVA");
});

prueba("al cancelar, con o sin forzar, la franja se asigna al primero de la lista", async (api) => {
  const x = franja("pista-1", 28, "18:00");
  const original = await reservar(api, TITULAR, x);
  const ea = await apuntar(api, ANA, x);
  const eb = await apuntar(api, BEA, x);
  const r = await api.pedir("POST", `/api/reservas/${original.id}/cancelar`);
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.reserva.estado, "cancelada");
  const nueva = (await api.pedir("GET", `/api/reservas/${r.cuerpo.asignadaA}`)).cuerpo.reserva;
  assert.deepEqual(nueva, { id: r.cuerpo.asignadaA, socioId: ANA, ...x, fin: "2026-11-28T19:30", estado: "confirmada", importeBase: 2800, descuento: 0, importe: 2800, notas: NOTA });
  assert.equal(await estadoGuardado(api, ea), "asignada");
  assert.equal(await posicion(api, eb), 1);

  // Dentro de las 24 horas: Marta López cancela con forzar y paga la penalización, y la franja pasa a quien espera.
  const ec = await apuntar(api, CARLOS, { pistaId: "pista-3", inicio: "2026-11-19T09:00" });
  const forzada = await api.pedir("POST", "/api/reservas/R-0520/cancelar", { cuerpo: { forzar: true } });
  assert.equal(forzada.cuerpo.reserva.penalizacion, 1200);
  const deCarlos = (await api.pedir("GET", `/api/reservas/${forzada.cuerpo.asignadaA}`)).cuerpo.reserva;
  assert.deepEqual([deCarlos.socioId, deCarlos.importe, deCarlos.notas], [CARLOS, 1200, NOTA]);
  assert.equal(await estadoGuardado(api, ec), "asignada");
});

prueba("se salta a quien ya no podría reservar y, si no queda nadie, asignadaA es null", async (api) => {
  const [x, y] = [franja("pista-2", 28, "18:00"), franja("pista-3", 28, "18:00")];
  const rx = await reservar(api, TITULAR, x);
  const ry = await reservar(api, TITULAR, y);
  const ea = await apuntar(api, ANA, x);
  const eb = await apuntar(api, BEA, x);
  const eby = await apuntar(api, BEA, y);
  for (const hora of ["09:00", "10:30", "12:00"]) await reservar(api, ANA, franja("pista-1", 29, hora));
  const r = await api.pedir("POST", `/api/reservas/${rx.id}/cancelar`);
  assert.equal((await api.pedir("GET", `/api/reservas/${r.cuerpo.asignadaA}`)).cuerpo.reserva.socioId, BEA);
  assert.deepEqual([await estadoGuardado(api, ea), await estadoGuardado(api, eb)], ["descartada", "asignada"]);
  for (const hora of ["09:00", "10:30"]) await reservar(api, BEA, franja("pista-2", 29, hora));
  const nadie = await api.pedir("POST", `/api/reservas/${ry.id}/cancelar`);
  assert.equal(nadie.cuerpo.asignadaA, null);
  assert.equal(await estadoGuardado(api, eby), "descartada");
});

prueba("cuando la franja empieza, sus esperas caducan: dejan de salir y no cuentan para el límite", async (api) => {
  const [x, y, z, w] = [franja("pista-1", 25, "09:00"), franja("pista-1", 26, "09:00"), franja("pista-2", 26, "09:00"), franja("pista-3", 26, "09:00")];
  for (const f of [x, y, z]) await reservar(api, TITULAR, f);
  await reservar(api, DANI, w);
  const ex = await apuntar(api, ANA, x);
  await apuntar(api, ANA, y);
  error(await pedirEspera(api, ANA, z), 409, "LIMITE_DE_ESPERAS");
  await api.pedir("POST", "/_reloj", { cuerpo: { ahora: x.inicio } });
  assert.equal(await posicion(api, ex), undefined);
  await apuntar(api, ANA, z);
  error(await pedirEspera(api, ANA, w), 409, "LIMITE_DE_ESPERAS");
});

prueba("cancelar una franja sin lista de espera responde como antes, más asignadaA: null", async (api) => {
  const x = franja("pista-3", 25, "12:00");
  const reserva = await reservar(api, TITULAR, x);
  const gratis = await api.pedir("POST", `/api/reservas/${reserva.id}/cancelar`);
  assert.deepEqual(gratis.cuerpo, { reserva: { ...reserva, estado: "cancelada" }, asignadaA: null });
  error(await api.pedir("POST", "/api/reservas/R-0520/cancelar"), 409, "FUERA_DE_PLAZO");
  const forzada = await api.pedir("POST", "/api/reservas/R-0520/cancelar", { cuerpo: { forzar: true } });
  assert.equal(forzada.cuerpo.reserva.penalizacion, 1200);
  assert.equal(forzada.cuerpo.asignadaA, null);
});

test("el README documenta la lista de espera", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  for (const texto of ["/api/esperas", "asignadaA", "FRANJA_LIBRE", "YA_EN_ESPERA", "YA_RESERVADA", "LIMITE_DE_ESPERAS", "ESPERA_NO_ENCONTRADA", "SIN_PERMISO"]) {
    assert.ok(readme.includes(texto), `el README menciona ${texto}`);
  }
});
