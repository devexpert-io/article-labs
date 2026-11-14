// La exportación de reservas a CSV (docs/specs/exportar-csv.md), probada a través de la API.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

const CABECERA = "id,fecha,hora,pista,socio,email,estado,importe,penalizacion,notas";
const GESTOR = "socio-040";

let api: Api;
before(async () => {
  api = await arrancarApi();
});
after(() => api.cerrar());

/** Pide la exportación como el gestor, como otro socio o, con null, sin cabecera X-Socio. */
function exportar(a: Api, consulta: string, socio: string | null = GESTOR) {
  return a.pedir("GET", `/api/reservas/exportar?${consulta}`, { socio: socio ?? undefined });
}

/** Lee un CSV del RFC 4180 cuyas líneas terminan en CRLF. */
function leerCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let entreComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') entreComillas = false;
      else campo += c;
    } else if (c === '"') entreComillas = true;
    else if (c === ",") {
      fila.push(campo);
      campo = "";
    } else if (c === "\r" && texto[i + 1] === "\n") {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
      i++;
    } else campo += c;
  }
  assert.equal(fila.length + campo.length, 0, "el CSV debe terminar en CRLF");
  return filas;
}

/** Crea una reserva por la API y comprueba que se ha creado (los socios que se usan tienen la cuota al día y hueco). */
async function reservar(a: Api, pistaId: string, inicio: string, socioId: string, notas?: string) {
  const r = await a.pedir("POST", "/api/reservas", { cuerpo: { socioId, pistaId, inicio, notas } });
  assert.equal(r.status, 201, r.texto);
  return r.cuerpo.reserva;
}

test("exportar es solo para gestores", async () => {
  const sinSocio = await exportar(api, "desde=2026-11-01&hasta=2026-11-30", null);
  assert.equal(sinSocio.status, 401);
  assert.equal(sinSocio.cuerpo.error.codigo, "NO_IDENTIFICADO");
  for (const socio of ["socio-001", "socio-041"]) {
    const socioNormal = await exportar(api, "desde=2026-11-01&hasta=2026-11-30", socio);
    assert.equal(socioNormal.status, 403);
    assert.equal(socioNormal.cuerpo.error.codigo, "SIN_PERMISO");
  }
  assert.equal((await exportar(api, "desde=2026-11-01&hasta=2026-11-30")).status, 200);
});

test("responde el CSV con su content-type y el periodo en el nombre del fichero", async () => {
  const r = await exportar(api, "desde=2026-10-15&hasta=2026-11-14&estado=cancelada");
  assert.equal(r.status, 200);
  assert.equal(r.cabeceras.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(r.cabeceras.get("content-disposition"), 'attachment; filename="reservas-2026-10-15-2026-11-14.csv"');
  assert.ok(r.texto.startsWith(`${CABECERA}\r\n`), "la primera línea es la cabecera");
});

test("un periodo sin reservas trae solo la cabecera", async () => {
  const r = await exportar(api, "desde=2030-01-01&hasta=2030-01-31");
  assert.equal(r.status, 200);
  assert.equal(r.texto, `${CABECERA}\r\n`);
});

test("hay una fila por cada reserva del periodo, en cualquier estado y con sus datos", async () => {
  const r = await exportar(api, "desde=2026-10-01&hasta=2026-10-31");
  const [cabecera, ...filas] = leerCsv(r.texto);
  assert.equal(cabecera!.join(","), CABECERA);
  const listado = await api.pedir("GET", "/api/reservas?desde=2026-10-01&hasta=2026-10-31&limite=1");
  assert.equal(filas.length, listado.cuerpo.total);
  assert.deepEqual(new Set(filas.map((f) => f[6])), new Set(["confirmada", "cancelada", "no_presentada"]));
  assert.ok(filas.every((f) => f.length === 10));

  const jueves = leerCsv((await exportar(api, "desde=2026-11-19&hasta=2026-11-19")).texto);
  const marta = jueves.find((f) => f[0] === "R-0520");
  assert.deepEqual(marta, ["R-0520", "2026-11-19", "09:00", "Pista 3", "Marta López", "marta.lopez@example.com", "confirmada", "12.00", "", ""]);
});

test("las filas van del primer al último día del periodo, ordenadas por inicio y por id de pista", async () => {
  const otra = await arrancarApi();
  try {
    // Se crean desordenadas: en el estado quedan en el orden de creación.
    const ultimo = await reservar(otra, "pista-2", "2026-12-03T21:00", "socio-041");
    const p3 = await reservar(otra, "pista-3", "2026-12-02T09:00", "socio-041");
    const p1 = await reservar(otra, "pista-1", "2026-12-02T09:00", "socio-041");
    const p2 = await reservar(otra, "pista-2", "2026-12-02T09:00", "socio-004");
    await reservar(otra, "pista-1", "2026-12-01T21:00", "socio-004");
    await reservar(otra, "pista-1", "2026-12-04T09:00", "socio-003");
    const filas = leerCsv((await exportar(otra, "desde=2026-12-02&hasta=2026-12-03")).texto).slice(1);
    assert.deepEqual(filas.map((f) => f[0]), [p1.id, p2.id, p3.id, ultimo.id]);
    assert.deepEqual(filas.map((f) => `${f[1]} ${f[2]} ${f[3]}`), [
      "2026-12-02 09:00 Pista 1", "2026-12-02 09:00 Pista 2", "2026-12-02 09:00 Pista 3", "2026-12-03 21:00 Pista 2",
    ]);
  } finally {
    otra.cerrar();
  }
});

test("los importes van en euros con dos decimales y la penalización, vacía si no hay", async () => {
  const otra = await arrancarApi();
  try {
    await otra.pedir("POST", "/api/reservas/R-0520/cancelar", { cuerpo: { forzar: true } });
    const gratis = await reservar(otra, "pista-1", "2026-12-05T18:00", "socio-041");
    await otra.pedir("POST", `/api/reservas/${gratis.id}/cancelar`);
    const filas = leerCsv((await exportar(otra, "desde=2026-11-19&hasta=2026-12-05")).texto).slice(1);
    const fila = (id: string) => filas.find((f) => f[0] === id)!;
    assert.deepEqual(fila("R-0520").slice(6, 9), ["cancelada", "12.00", "12.00"]);
    assert.deepEqual(fila(gratis.id).slice(6, 9), ["cancelada", "28.00", ""]);
    assert.ok(filas.every((f) => /^\d+\.\d{2}$/.test(f[7]!)));
  } finally {
    otra.cerrar();
  }
});

test("escapa las comas, las comillas y los saltos de línea de las notas, y nada más", async () => {
  const otra = await arrancarApi();
  try {
    const notas = ["Pala nueva, bolas y agua", 'Dice que es "urgente"', "Primera línea\nSegunda línea", "Hola\r\nAdiós", "Sin nada raro: palas y bolas."];
    const reservas = [];
    for (const [i, nota] of notas.entries()) {
      reservas.push(await reservar(otra, "pista-1", `2026-12-${String(i + 7).padStart(2, "0")}T12:00`, ["socio-041", "socio-004", "socio-003"][i % 3]!, nota));
    }
    const texto = (await exportar(otra, "desde=2026-12-07&hasta=2026-12-11")).texto;
    assert.ok(texto.includes(',"Pala nueva, bolas y agua"\r\n'));
    assert.ok(texto.includes(',"Dice que es ""urgente"""\r\n'));
    assert.ok(texto.includes(',"Primera línea\nSegunda línea"\r\n'));
    assert.ok(texto.includes(',"Hola\r\nAdiós"\r\n'));
    assert.ok(texto.includes(`${reservas[4].id},2026-12-11,12:00,Pista 1,`));
    assert.ok(texto.includes(",18.00,,Sin nada raro: palas y bolas.\r\n"));
    assert.deepEqual(leerCsv(texto).slice(1).map((f) => f[9]), notas);
  } finally {
    otra.cerrar();
  }
});

test("cada línea termina en CRLF, también la última", async () => {
  const texto = (await exportar(api, "desde=2026-11-01&hasta=2026-11-24")).texto;
  assert.ok(texto.endsWith("\r\n"));
  assert.doesNotMatch(texto, /[^\r]\n|\r[^\n]/);
});

test("desde y hasta son obligatorios, con formato AAAA-MM-DD, en orden y como mucho 92 días", async () => {
  const errores: Array<[string, string]> = [
    ["hasta=2026-11-30", "DATOS_INVALIDOS"],
    ["desde=2026-11-01", "DATOS_INVALIDOS"],
    ["desde=2026-11-1&hasta=2026-11-30", "DATOS_INVALIDOS"],
    ["desde=2026-11-01&hasta=30/11/2026", "DATOS_INVALIDOS"],
    ["desde=2026-11-30&hasta=2026-11-01", "DATOS_INVALIDOS"],
    ["desde=2026-09-01&hasta=2026-12-02", "RANGO_DEMASIADO_GRANDE"],
    ["desde=2027-01-01&hasta=2027-04-03", "RANGO_DEMASIADO_GRANDE"],
  ];
  for (const [consulta, codigo] of errores) {
    const r = await exportar(api, consulta);
    assert.equal(r.status, 400, consulta);
    assert.equal(r.cuerpo.error.codigo, codigo, consulta);
  }
  // 92 días contando los dos extremos, con el cambio de hora de octubre o de marzo por medio.
  for (const consulta of ["desde=2026-09-01&hasta=2026-12-01", "desde=2027-01-01&hasta=2027-04-02", "desde=2026-11-18&hasta=2026-11-18"]) {
    assert.equal((await exportar(api, consulta)).status, 200, consulta);
  }
});

test("estado filtra las filas y solo vale confirmada, cancelada o no_presentada", async () => {
  for (const estado of ["confirmada", "cancelada", "no_presentada"]) {
    const filas = leerCsv((await exportar(api, `desde=2026-10-01&hasta=2026-10-31&estado=${estado}`)).texto).slice(1);
    const listado = await api.pedir("GET", `/api/reservas?desde=2026-10-01&hasta=2026-10-31&estado=${estado}&limite=1`);
    assert.equal(filas.length, listado.cuerpo.total, estado);
    assert.ok(filas.every((f) => f[6] === estado), estado);
  }
  const r = await exportar(api, "desde=2026-10-01&hasta=2026-10-31&estado=pendiente");
  assert.equal(r.status, 400);
  assert.equal(r.cuerpo.error.codigo, "DATOS_INVALIDOS");
});

test("GET /api/reservas responde igual que antes", async () => {
  const otra = await arrancarApi();
  try {
    await reservar(otra, "pista-1", "2026-12-03T09:00", "socio-041");
    await reservar(otra, "pista-1", "2026-12-02T09:00", "socio-041");
    const consultas = ["/api/reservas", "/api/reservas?desde=2026-11-15&hasta=2026-12-31&limite=100", "/api/reservas?desde=2026-08-01&hasta=2026-12-31&limite=1"];
    const antes = await Promise.all(consultas.map((c) => otra.pedir("GET", c)));
    await exportar(otra, "desde=2026-11-01&hasta=2026-12-31");
    const despues = await Promise.all(consultas.map((c) => otra.pedir("GET", c)));
    assert.deepEqual(despues.map((r) => r.cuerpo), antes.map((r) => r.cuerpo));
    // Sigue sin pedir X-Socio, sin limitar el periodo y sin exigir que desde vaya antes que hasta.
    assert.deepEqual(antes.map((r) => r.status), [200, 200, 200]);
    const alReves = await otra.pedir("GET", "/api/reservas?desde=2026-11-20&hasta=2026-11-10");
    assert.deepEqual([alReves.status, alReves.cuerpo.total], [200, 0]);
  } finally {
    otra.cerrar();
  }
});

test("el README documenta la exportación", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  for (const texto of ["GET /api/reservas/exportar", "SIN_PERMISO", "RANGO_DEMASIADO_GRANDE", "text/csv; charset=utf-8"]) {
    assert.ok(readme.includes(texto), `el README debe mencionar ${texto}`);
  }
});
