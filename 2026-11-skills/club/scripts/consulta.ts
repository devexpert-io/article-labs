// Consultas sobre la actividad del club, calculadas sobre el estado de la semilla.
// Uso: node scripts/consulta.ts <consulta> --mes AAAA-MM [opciones]. Con --help, la lista de consultas.
import { crearSemilla, diaDeLaSemana, HORAS } from "../src/semilla.ts";
import type { Reserva } from "../src/tipos.ts";

const AYUDA = `Consultas sobre la actividad del club (estado de la semilla).

  node scripts/consulta.ts franjas --mes AAAA-MM
      Reservas confirmadas por hora de inicio, de más a menos.
  node scripts/consulta.ts ingresos --mes AAAA-MM [--pista pista-N]
      Céntimos y euros por pista: reservas confirmadas y no presentadas por su importe, y penalizaciones aparte.
  node scripts/consulta.ts cancelaciones --mes AAAA-MM [--top N]
      Socios con más reservas canceladas.
  node scripts/consulta.ts ocupacion --mes AAAA-MM [--pista pista-N] [--finde | --laborables]
      Porcentaje de franjas con una reserva no cancelada, por pista (solo los días en que la pista estaba abierta).

Todas aceptan --json para la salida en JSON.`;

const args = process.argv.slice(2);
const opcion = (nombre: string) => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const bandera = (nombre: string) => args.includes(`--${nombre}`);
const consulta = args[0];
if (!consulta || bandera("help") || consulta === "help") {
  console.log(AYUDA);
  process.exit(0);
}
const mes = opcion("mes");
if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
  console.error("Falta --mes AAAA-MM. Usa --help.");
  process.exit(1);
}
const estado = crearSemilla();
const delMes = estado.reservas.filter((r) => r.inicio.startsWith(mes));
const euros = (c: number) => (c / 100).toFixed(2).replace(".", ",") + " €";
const salir = (datos: unknown, texto: string) => {
  console.log(bandera("json") ? JSON.stringify(datos, null, 1) : texto);
};

function diasDelMes(m: string): string[] {
  const [a, mm] = m.split("-").map(Number);
  const n = new Date(Date.UTC(a!, mm!, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${m}-${String(i + 1).padStart(2, "0")}`);
}

if (consulta === "franjas") {
  const cuenta = new Map<string, number>(HORAS.map((h) => [h, 0]));
  for (const r of delMes) if (r.estado === "confirmada") cuenta.set(r.inicio.slice(11), (cuenta.get(r.inicio.slice(11)) ?? 0) + 1);
  const filas = [...cuenta].map(([hora, reservas]) => ({ hora, reservas })).sort((a, b) => b.reservas - a.reservas || a.hora.localeCompare(b.hora));
  salir(filas, filas.map((f) => `${f.hora}  ${f.reservas}`).join("\n"));
} else if (consulta === "ingresos") {
  const pista = opcion("pista");
  const filas = estado.pistas.filter((p) => !pista || p.id === pista).map((p) => {
    const suyas = delMes.filter((r: Reserva) => r.pistaId === p.id);
    const reservas = suyas.filter((r) => r.estado !== "cancelada").reduce((s, r) => s + r.importe, 0);
    const penalizaciones = suyas.reduce((s, r) => s + (r.penalizacion ?? 0), 0);
    return { pista: p.id, reservas_centimos: reservas, penalizaciones_centimos: penalizaciones };
  });
  salir(filas, filas.map((f) => `${f.pista}  reservas ${euros(f.reservas_centimos)}  penalizaciones ${euros(f.penalizaciones_centimos)}`).join("\n"));
} else if (consulta === "cancelaciones") {
  const top = Number(opcion("top") ?? 5);
  const cuenta = new Map<string, number>();
  for (const r of delMes) if (r.estado === "cancelada") cuenta.set(r.socioId, (cuenta.get(r.socioId) ?? 0) + 1);
  const filas = [...cuenta].map(([socioId, canceladas]) => ({ socioId, nombre: estado.socios.find((s) => s.id === socioId)!.nombre, canceladas }))
    .sort((a, b) => b.canceladas - a.canceladas || a.socioId.localeCompare(b.socioId)).slice(0, top);
  const total = [...cuenta.values()].reduce((s, n) => s + n, 0);
  salir({ total, socios: cuenta.size, top: filas },
    [`${total} canceladas por ${cuenta.size} socios`, ...filas.map((f) => `${f.socioId}  ${f.nombre}  ${f.canceladas}`)].join("\n"));
} else if (consulta === "ocupacion") {
  const pista = opcion("pista");
  const finde = bandera("finde"), laborables = bandera("laborables");
  const dias = diasDelMes(mes).filter((d) => {
    const dia = diaDeLaSemana(d);
    const esFinde = dia === 0 || dia === 6;
    return finde ? esFinde : laborables ? !esFinde : true;
  });
  const filas = estado.pistas.filter((p) => !pista || p.id === pista).map((p) => {
    // La pista 4 cerró por obras el 9 de noviembre de 2026.
    const abiertos = dias.filter((d) => !(p.id === "pista-4" && d >= "2026-11-09"));
    const franjas = abiertos.length * HORAS.length;
    const ocupadas = delMes.filter((r) => r.pistaId === p.id && r.estado !== "cancelada" && abiertos.includes(r.inicio.slice(0, 10))).length;
    return { pista: p.id, franjas, ocupadas, porcentaje: franjas ? Math.round((ocupadas / franjas) * 1000) / 10 : 0 };
  });
  salir(filas, filas.map((f) => `${f.pista}  ${f.ocupadas}/${f.franjas}  ${String(f.porcentaje).replace(".", ",")} %`).join("\n"));
} else {
  console.error(`No conozco la consulta "${consulta}". Usa --help.`);
  process.exit(1);
}
