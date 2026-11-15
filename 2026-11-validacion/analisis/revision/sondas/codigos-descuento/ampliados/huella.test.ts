// Sonda: huella de los socios y las reservas de la semilla, con los mismos campos que usa X3.
import { createHash } from "node:crypto";
import { test } from "node:test";
import { arrancarApi } from "./ayuda.ts";

const huella = (datos: unknown) => createHash("sha256").update(JSON.stringify(datos)).digest("hex");
const porId = (a: any[], b: any[]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

test("sonda: huella de la semilla", async () => {
  const api = await arrancarApi({ TZ: "UTC" });
  try {
    const estado = (await api.pedir("GET", "/_estado")).cuerpo;
    const socios = estado.socios.map((s: any) => [s.id, s.nombre, s.email, s.cuotaActiva, s.rol]).sort(porId);
    const reservas = estado.reservas
      .map((r: any) => [r.id, r.socioId, r.pistaId, r.inicio, r.fin, r.estado, r.importe, r.notas, r.penalizacion ?? null, r.motivoCancelacion ?? null])
      .sort(porId);
    console.log("HUELLA socios", socios.length, huella(socios));
    console.log("HUELLA reservas", reservas.length, huella(reservas));
    console.log("HUELLA primer y ultimo id", reservas[0][0], reservas[reservas.length - 1][0], "contador", estado.contador);
    const claves = new Set<string>();
    for (const r of estado.reservas) for (const k of Object.keys(r)) claves.add(k);
    console.log("HUELLA claves de las reservas", [...claves].join(","));
    const claves2 = new Set<string>();
    for (const s of estado.socios) for (const k of Object.keys(s)) claves2.add(k);
    console.log("HUELLA claves de los socios", [...claves2].join(","));
  } finally {
    api.cerrar();
  }
});
