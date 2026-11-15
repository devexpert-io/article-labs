// Saca de la base los datos que X1 compara: la huella de las reservas de la semilla y las de octubre de socio-029.
import { createHash } from "node:crypto";
import { test } from "node:test";
import { arrancarApi, type Api } from "./ayuda.ts";

async function todas(api: Api): Promise<any[]> {
  const lista: any[] = [];
  for (let pagina = 1; ; pagina++) {
    const r = await api.pedir("GET", `/api/reservas?limite=100&pagina=${pagina}`);
    lista.push(...r.cuerpo.reservas);
    if (pagina >= r.cuerpo.paginas) return lista;
  }
}

function canonica(reservas: any[]) {
  return reservas
    .map((r) => [r.id, r.socioId, r.pistaId, r.inicio, r.fin, r.estado, r.importe, r.notas, (r.penalizacion ?? 0) || null, r.motivoCancelacion ?? null])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

test("datos de la base", { timeout: 60_000 }, async () => {
  const api = await arrancarApi({ AHORA: "2026-11-18T10:00", TZ: "UTC" });
  try {
    const reservas = await todas(api);
    const filas = canonica(reservas);
    const huella = createHash("sha256").update(JSON.stringify(filas)).digest("hex");
    const porEstado: Record<string, { n: number; importe: number }> = {};
    for (const r of reservas) {
      porEstado[r.estado] ??= { n: 0, importe: 0 };
      porEstado[r.estado]!.n += 1;
      porEstado[r.estado]!.importe += r.importe;
    }
    console.log("SONDA huella", huella, filas.length);
    console.log("SONDA porEstado", JSON.stringify(porEstado));
    console.log("SONDA conPenalizacion", reservas.filter((r) => r.penalizacion !== undefined).length, "conMotivo", reservas.filter((r) => r.motivoCancelacion !== undefined).length);
    const oct = reservas.filter((r) => r.socioId === "socio-029" && r.inicio.startsWith("2026-10"));
    console.log("SONDA socio-029 octubre", JSON.stringify(oct.map((r) => [r.id, r.inicio, r.estado, r.importe, r.penalizacion])));
    const canceladasOct = reservas.filter((r) => r.inicio.startsWith("2026-10") && r.estado === "cancelada");
    console.log("SONDA canceladas de octubre", canceladasOct.length, JSON.stringify(canceladasOct.slice(0, 3).map((r) => r.id)));
  } finally {
    api.cerrar();
  }
});
