// Sonda de revisión (exportar-csv): registra cómo responde la exportación a fechas imposibles, estado vacío,
// precedencia de errores y notas que parecen fórmulas. No afirma nada salvo que la API arranca: se lee la salida.
import assert from "node:assert/strict";
import { test } from "node:test";
import { arrancarApi } from "./ayuda.ts";

const GESTOR = "socio-040";

test("sonda exportar", { timeout: 60_000 }, async () => {
  const api = await arrancarApi({ TZ: "Europe/Madrid" });
  try {
    const consultas = [
      "desde=2026-02-30&hasta=2026-03-05",
      "desde=2026-02-29&hasta=2026-03-05",
      "desde=2026-09-31&hasta=2026-10-05",
      "desde=2026-11-31&hasta=2026-12-01",
      "desde=2027-13-01&hasta=2027-13-11",
      "desde=2027-00-10&hasta=2027-01-11",
      "desde=2027-02-00&hasta=2027-02-10",
      "desde=2027-01-01&hasta=2027-13-11",
      "desde=2026-01-01&hasta=2026-12-31&estado=pagada",
      "desde=2026-11-18&hasta=2026-11-20&estado=",
      "desde=2026-11-18&hasta=2026-11-20&estado=pagada",
      "desde=2026-10-01&hasta=2026-10-05",
    ];
    for (const c of consultas) {
      const r = await api.pedir("GET", `/api/reservas/exportar?${c}`, { socio: GESTOR });
      const filas = typeof r.cuerpo === "string" ? r.texto.split("\r\n").filter(Boolean).length - 1 : null;
      const primera = typeof r.cuerpo === "string" ? r.texto.split("\r\n")[1] ?? "" : "";
      console.log(`EXPORTAR ${c} -> ${r.status} ${typeof r.cuerpo === "string" ? `filas=${filas} primera=${primera.slice(0, 40)}` : r.texto.slice(0, 160)}`);
    }
    // Lo mismo en GET /api/reservas (comportamiento de la base para fechas imposibles).
    for (const c of ["desde=2026-09-31&hasta=2026-10-05", "desde=2027-13-01&hasta=2027-13-11", "fecha=2026-02-30"]) {
      const r = await api.pedir("GET", `/api/reservas?${c}`);
      console.log(`LISTAR ${c} -> ${r.status} ${r.status === 200 ? `total=${r.cuerpo.total}` : r.texto.slice(0, 160)}`);
    }
    // Notas con aspecto de fórmula.
    const creada = await api.pedir("POST", "/api/reservas", {
      cuerpo: { socioId: "socio-003", pistaId: "pista-1", inicio: "2026-11-30T09:00", notas: '=HYPERLINK("http://x","y")' },
    });
    console.log(`CREAR nota formula -> ${creada.status}`);
    const r = await api.pedir("GET", "/api/reservas/exportar?desde=2026-11-30&hasta=2026-11-30", { socio: GESTOR });
    console.log(`EXPORTAR nota formula -> ${r.status} ${JSON.stringify(r.texto.split("\r\n").filter((l) => l.includes("HYPERLINK")))}`);
    assert.ok(true);
  } finally {
    api.cerrar();
  }
});
