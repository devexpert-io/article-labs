// Sonda de revisión (duraciones): registra cómo responde POST /api/reservas a inicios con minutos o horas fuera de rango,
// a fechas imposibles y a duracion null, y cómo quedan la reserva, su detalle, el listado y la disponibilidad.
// No afirma nada salvo que la API arranca: se lee la salida.
import assert from "node:assert/strict";
import { test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

const AHORA = "2026-11-18T10:00";

async function sociosConSitio(api: Api): Promise<string[]> {
  const estado = (await api.pedir("GET", "/_estado")).cuerpo;
  const futuras = new Map<string, number>();
  for (const r of estado.reservas) {
    if (r.estado === "confirmada" && r.inicio > AHORA) futuras.set(r.socioId, (futuras.get(r.socioId) ?? 0) + 1);
  }
  return estado.socios.filter((s: any) => s.cuotaActiva && s.rol === "socio" && !futuras.has(s.id)).map((s: any) => s.id);
}

function resumen(r: { status: number; cuerpo: any; texto: string }): string {
  if (r.status === 201 || r.status === 200) {
    const x = r.cuerpo.reserva;
    return `${r.status} i=${x.inicio.slice(5)} f=${x.fin.slice(5)} d=${JSON.stringify(x.duracion)} e=${JSON.stringify(x.importe)}`;
  }
  return `${r.status} ${r.cuerpo?.error?.codigo ?? r.texto.slice(0, 120)}`;
}

test("sonda inicios", { timeout: 120_000 }, async () => {
  const api = await arrancarApi({ TZ: "Europe/Madrid", AHORA });
  try {
    const socios = await sociosConSitio(api);
    let i = 0;
    const socio = () => socios[i++ % socios.length]!;
    // Cada caso en un día distinto de diciembre (libre en la semilla), pista 1: así no chocan entre sí.
    const casos: [string, number | null | undefined][] = [
      ["10:60", 60], ["10:60", 90], ["09:90", 60], ["09:60", 60], ["12:60", 90], ["20:60", 60], ["08:60", 60], ["08:90", 60],
      ["21:90", 60], ["22:60", 60], ["12:75", 60], ["10:75", 60], ["10:45", 60],
      ["99:00", 60], ["98:00", 120], ["99:30", 90], ["99:00", 120], ["98:30", 120], ["24:00", 60], ["25:00", 60], ["23:00", 60],
      ["10:00", null], ["10:00", undefined],
    ];
    let dia = 1;
    const creadas: { id: string; caso: string; fecha: string }[] = [];
    for (const [hora, duracion] of casos) {
      const fecha = `2026-12-${String(dia++).padStart(2, "0")}`;
      const cuerpo: Record<string, unknown> = { socioId: socio(), pistaId: "pista-1", inicio: `${fecha}T${hora}` };
      if (duracion !== undefined) cuerpo.duracion = duracion;
      const r = await api.pedir("POST", "/api/reservas", { cuerpo });
      const caso = `${fecha}T${hora} dur=${duracion}`;
      console.log(`CREAR ${caso} -> ${resumen(r)}`);
      if (r.status === 201) creadas.push({ id: r.cuerpo.reserva.id, caso, fecha });
    }
    // Fechas imposibles (con horas válidas en la base y en la feature).
    const imposibles: [string, number | undefined][] = [
      ["2026-11-31T12:00", undefined], ["2026-13-01T12:00", undefined], ["2026-99-99T12:00", undefined],
      ["2027-13-01T09:00", 60], ["2027-13-02T09:00", 90], ["2027-13-03T09:00", 120], ["2027-02-31T10:30", undefined],
      ["2026-11-31T12:00", 60], ["2026-13-01T13:30", 120], ["2026-13-45T10:00", undefined], ["2026-13-45T10:30", undefined],
    ];
    for (const [inicio, duracion] of imposibles) {
      const cuerpo: Record<string, unknown> = { socioId: socio(), pistaId: "pista-2", inicio };
      if (duracion !== undefined) cuerpo.duracion = duracion;
      const r = await api.pedir("POST", "/api/reservas", { cuerpo });
      const caso = `${inicio} dur=${duracion}`;
      console.log(`IMPOSIBLE ${caso} -> ${resumen(r)}`);
      if (r.status === 201) creadas.push({ id: r.cuerpo.reserva.id, caso, fecha: inicio.slice(0, 10) });
    }
    // Detalle y listado de lo creado.
    for (const c of creadas) {
      const detalle = await api.pedir("GET", `/api/reservas/${c.id}`);
      const listado = await api.pedir("GET", `/api/reservas?fecha=${c.fecha}&pista=${detalle.cuerpo?.reserva?.pistaId ?? ""}`);
      const enLista = listado.status === 200 ? listado.cuerpo.reservas.find((x: any) => x.id === c.id) : undefined;
      console.log(`DET ${c.caso} -> ${resumen(detalle)} | L${listado.status} ${enLista ? `d=${JSON.stringify(enLista.duracion)} f=${enLista.fin.slice(5)}` : "no está"}`);
    }
    // Disponibilidad del día de cada reserva rara de la pista 1 y de fechas imposibles.
    for (const c of creadas.slice(0, 8)) {
      const d = await api.pedir("GET", `/api/disponibilidad?fecha=${c.fecha}&pista=pista-1`);
      if (d.status !== 200) { console.log(`DISPO ${c.fecha} -> ${d.status} ${d.texto.slice(0, 120)}`); continue; }
      const p = d.cuerpo.pistas[0];
      const reservadas = p.franjas.filter((f: any) => f.estado === "reservada").map((f: any) => f.inicio.slice(11));
      console.log(`DISPO ${c.caso} -> huecos=${JSON.stringify((p.huecos ?? []).map((h: any) => `${h.inicio.slice(11)}-${h.fin.slice(11)}`))} res=${JSON.stringify(reservadas)}`);
    }
    for (const fecha of ["2026-13-01", "2026-11-32", "0000-00-00", "2026-02-30", "2026-11-31", "2026-99-99"]) {
      const d = await api.pedir("GET", `/api/disponibilidad?fecha=${fecha}&pista=pista-1`);
      if (d.status !== 200) { console.log(`DISPO-FECHA ${fecha} -> ${d.status} ${d.texto.slice(0, 120)}`); continue; }
      const p = d.cuerpo.pistas[0];
      console.log(`DISPO-FECHA ${fecha} -> 200 f0=${p.franjas[0].inicio}/${p.franjas[0].fin} huecos=${JSON.stringify((p.huecos ?? []).map((h: any) => `${h.inicio}-${h.fin}`))}`);
    }
    assert.ok(true);
  } finally {
    api.cerrar();
  }
});
