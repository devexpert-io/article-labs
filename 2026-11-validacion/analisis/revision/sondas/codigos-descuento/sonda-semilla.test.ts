// Sonda: lo que la semilla expone por la API (socios, reservas del 16 de noviembre, duplicados, contador).
import { test } from "node:test";
import { arrancarApi } from "./ayuda.ts";

test("sonda: semilla", async () => {
  const api = await arrancarApi();
  try {
    const estado = (await api.pedir("GET", "/_estado")).cuerpo;
    console.log("SEMILLA socios:", estado.socios.length, "reservas:", estado.reservas.length, "contador:", estado.contador);
    console.log("SEMILLA socio-042:", JSON.stringify(estado.socios.find((s: any) => s.id === "socio-042") ?? null));
    const de42 = estado.reservas.filter((r: any) => r.socioId === "socio-042");
    console.log("SEMILLA reservas de socio-042:", JSON.stringify(de42));
    const conCodigo = estado.reservas.filter((r: any) => r.codigo !== undefined);
    console.log("SEMILLA reservas de la semilla con codigo:", conCodigo.length);
    // Franjas con dos reservas confirmadas o más (en cualquier fecha).
    const cuenta = new Map<string, number>();
    for (const r of estado.reservas) if (r.estado === "confirmada") cuenta.set(`${r.pistaId}|${r.inicio}`, (cuenta.get(`${r.pistaId}|${r.inicio}`) ?? 0) + 1);
    console.log("SEMILLA franjas con dos confirmadas:", JSON.stringify([...cuenta].filter(([, n]) => n > 1)));
    const dia16 = estado.reservas.filter((r: any) => r.inicio.startsWith("2026-11-16") && ["pista-1|2026-11-16T09:00", "pista-2|2026-11-16T10:30", "pista-3|2026-11-16T12:00"].includes(`${r.pistaId}|${r.inicio}`));
    console.log("SEMILLA reservas en las franjas usadas por socio-042 el 16:", JSON.stringify(dia16.map((r: any) => [r.id, r.socioId, r.pistaId, r.inicio, r.estado, r.codigo ?? null])));
    const lista16 = await api.pedir("GET", "/api/reservas?fecha=2026-11-16&limite=100");
    console.log("SEMILLA GET /api/reservas?fecha=2026-11-16 total:", lista16.cuerpo.total);
    const nov = await api.pedir("GET", "/api/reservas?desde=2026-11-01&hasta=2026-11-30&limite=1");
    console.log("SEMILLA total noviembre:", nov.cuerpo.total);
    const disp = await api.pedir("GET", "/api/disponibilidad?fecha=2026-11-16");
    console.log("SEMILLA disponibilidad 16:", JSON.stringify(disp.cuerpo.pistas.map((p: any) => [p.pistaId, p.franjas.map((f: any) => f.estado[0]).join("")])));
    const buscar = await api.pedir("GET", "/api/socios?texto=pruebas");
    console.log("SEMILLA GET /api/socios?texto=pruebas:", JSON.stringify(buscar.cuerpo));
    const primera = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-003", pistaId: "pista-3", inicio: "2026-11-24T12:00" } });
    console.log("SEMILLA id de la primera reserva nueva:", primera.cuerpo?.reserva?.id);
    // CLUB10 de socio-042: cuantos usos le quedan.
    const r1 = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-042", pistaId: "pista-1", inicio: "2026-11-20T09:00", codigo: "CLUB10" } });
    const r2 = await api.pedir("POST", "/api/reservas", { cuerpo: { socioId: "socio-042", pistaId: "pista-2", inicio: "2026-11-20T10:30", codigo: "CLUB10" } });
    console.log("SEMILLA CLUB10 socio-042 primera/segunda:", r1.status, r1.cuerpo?.error?.codigo ?? r1.cuerpo?.reserva?.descuento, r2.status, r2.cuerpo?.error?.codigo ?? r2.cuerpo?.reserva?.descuento);
    const g = de42[0] ? await api.pedir("GET", `/api/reservas/${de42[0].id}`) : null;
    console.log("SEMILLA GET de la reserva de semilla de socio-042:", g ? JSON.stringify(g.cuerpo) : null);
  } finally {
    api.cerrar();
  }
});
