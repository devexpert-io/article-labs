// Las operaciones del club y sus reglas. La API HTTP (src/servidor.ts) es la única que las llama.
import { finDeFranja, HORAS, precio } from "./semilla.ts";
import type { Estado, EstadoReserva, Reserva, Socio } from "./tipos.ts";

export class ErrorDelClub extends Error {
  codigo: string;
  http: number;
  constructor(codigo: string, mensaje: string, http = 409) {
    super(mensaje);
    this.codigo = codigo;
    this.http = http;
  }
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const FECHA_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export const LIMITE_MAXIMO = 100;
export const LIMITE_POR_DEFECTO = 50;
export const MAXIMO_RESERVAS_FUTURAS = 3;
export const HORAS_CANCELACION_GRATUITA = 24;
/** Días que puede abarcar como mucho una exportación, contando el primero y el último. */
export const MAXIMO_DIAS_EXPORTACION = 92;
export const CABECERA_CSV = ["id", "fecha", "hora", "pista", "socio", "email", "estado", "importe", "penalizacion", "notas"];
const ESTADOS_RESERVA: readonly string[] = ["confirmada", "cancelada", "no_presentada"];

function invalido(mensaje: string): never {
  throw new ErrorDelClub("DATOS_INVALIDOS", mensaje, 400);
}

/** Días transcurridos desde el 1-1-1970 hasta una fecha AAAA-MM-DD, o undefined si esa fecha no existe (2026-02-30). */
function numeroDeDia(fecha: string): number | undefined {
  if (!FECHA.test(fecha)) return undefined;
  const [anio, mes, dia] = fecha.split("-").map(Number) as [number, number, number];
  const d = new Date(0);
  d.setUTCFullYear(anio, mes - 1, dia);
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return undefined;
  return d.getTime() / 86_400_000;
}

/** Una fecha obligatoria de un filtro, con su número de día para contar los días del periodo. */
function fechaObligatoria(nombre: string, valor: string | undefined): { fecha: string; dia: number } {
  const dia = valor === undefined ? undefined : numeroDeDia(valor);
  if (valor === undefined || dia === undefined) invalido(`${nombre} es obligatorio y debe ser una fecha AAAA-MM-DD`);
  return { fecha: valor, dia };
}

/** Céntimos a euros con dos decimales y punto: 1800 → "18.00". */
function euros(centimos: number): string {
  const absoluto = Math.abs(centimos);
  return `${centimos < 0 ? "-" : ""}${Math.floor(absoluto / 100)}.${String(absoluto % 100).padStart(2, "0")}`;
}

/** Un campo de CSV según el RFC 4180: entre comillas dobles solo si lleva comas, comillas o saltos de línea. */
function campoCsv(valor: string): string {
  return /[",\r\n]/.test(valor) ? `"${valor.replaceAll('"', '""')}"` : valor;
}

function comparar(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface FiltrosExportacion {
  desde?: string;
  hasta?: string;
  estado?: string;
}

export interface ExportacionCsv {
  /** Nombre del fichero para la cabecera content-disposition. */
  fichero: string;
  csv: string;
}

function sinAcentos(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function horasEntre(desde: string, hasta: string): number {
  return (Date.parse(`${hasta}:00Z`) - Date.parse(`${desde}:00Z`)) / 3_600_000;
}

export interface FiltrosReservas {
  fecha?: string;
  desde?: string;
  hasta?: string;
  socioId?: string;
  pistaId?: string;
  estado?: string;
  limite?: number;
  pagina?: number;
}

export function crearClub(estado: Estado) {
  const pista = (id: string) => {
    const encontrada = estado.pistas.find((p) => p.id === id);
    if (!encontrada) throw new ErrorDelClub("PISTA_NO_ENCONTRADA", `No existe la pista ${id}`, 404);
    return encontrada;
  };
  const reserva = (id: string) => {
    const encontrada = estado.reservas.find((r) => r.id === id);
    if (!encontrada) throw new ErrorDelClub("RESERVA_NO_ENCONTRADA", `No existe la reserva ${id}`, 404);
    return encontrada;
  };
  const ocupada = (pistaId: string, inicio: string) =>
    estado.reservas.some((r) => r.pistaId === pistaId && r.inicio === inicio && r.estado === "confirmada");

  return {
    listarPistas() {
      return { pistas: estado.pistas };
    },

    cambiarEstadoPista(pistaId: string, nuevo: unknown) {
      if (nuevo !== "operativa" && nuevo !== "cerrada") invalido('estado debe ser "operativa" o "cerrada"');
      const p = pista(pistaId);
      p.estado = nuevo as "operativa" | "cerrada";
      return { pista: p };
    },

    disponibilidad(fecha: unknown, pistaId?: string) {
      if (typeof fecha !== "string" || !FECHA.test(fecha)) invalido("fecha es obligatoria, con el formato AAAA-MM-DD");
      const pistas = pistaId ? [pista(pistaId)] : estado.pistas;
      return {
        fecha,
        pistas: pistas.map((p) => ({
          pistaId: p.id,
          nombre: p.nombre,
          cubierta: p.cubierta,
          estado: p.estado,
          franjas: HORAS.map((hora) => {
            const inicio = `${fecha}T${hora}`;
            return {
              inicio,
              fin: finDeFranja(inicio),
              estado: p.estado === "cerrada" ? "cerrada" : ocupada(p.id, inicio) ? "reservada" : "libre",
              precio: precio(p, inicio),
            };
          }),
        })),
      };
    },

    buscarSocios(texto: unknown) {
      if (typeof texto !== "string" || texto.trim().length < 2) invalido("texto es obligatorio, con dos letras o más");
      const buscado = sinAcentos(texto.trim());
      const socios = estado.socios.filter((s) => sinAcentos(s.nombre).includes(buscado) || s.email.includes(buscado) || s.id === buscado);
      return { socios: socios.slice(0, 20) };
    },

    listarReservas(f: FiltrosReservas) {
      for (const campo of ["fecha", "desde", "hasta"] as const) {
        if (f[campo] !== undefined && !FECHA.test(f[campo]!)) invalido(`${campo} debe tener el formato AAAA-MM-DD`);
      }
      if (f.estado !== undefined && !["confirmada", "cancelada", "no_presentada"].includes(f.estado)) {
        invalido('estado debe ser "confirmada", "cancelada" o "no_presentada"');
      }
      const limite = f.limite ?? LIMITE_POR_DEFECTO;
      const pagina = f.pagina ?? 1;
      if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) invalido(`limite debe estar entre 1 y ${LIMITE_MAXIMO}`);
      if (!Number.isInteger(pagina) || pagina < 1) invalido("pagina debe ser 1 o más");
      const desde = f.fecha ?? f.desde;
      const hasta = f.fecha ?? f.hasta;
      const todas = estado.reservas.filter((r) =>
        (!desde || r.inicio.slice(0, 10) >= desde) &&
        (!hasta || r.inicio.slice(0, 10) <= hasta) &&
        (!f.socioId || r.socioId === f.socioId) &&
        (!f.pistaId || r.pistaId === f.pistaId) &&
        (!f.estado || r.estado === (f.estado as EstadoReserva)));
      const paginas = Math.max(1, Math.ceil(todas.length / limite));
      return { total: todas.length, pagina, paginas, reservas: todas.slice((pagina - 1) * limite, pagina * limite) };
    },

    /** Las reservas que empiezan entre desde y hasta (ambos días incluidos), en CSV. Solo para gestores. */
    exportarReservas(quien: Socio | undefined, f: FiltrosExportacion): ExportacionCsv {
      if (!quien) throw new ErrorDelClub("NO_IDENTIFICADO", "Para exportar hay que identificarse con la cabecera X-Socio", 401);
      if (quien.rol !== "gestor") throw new ErrorDelClub("SIN_PERMISO", "Solo un gestor puede exportar las reservas", 403);
      const desde = fechaObligatoria("desde", f.desde);
      const hasta = fechaObligatoria("hasta", f.hasta);
      if (desde.dia > hasta.dia) invalido("desde no puede ser posterior a hasta");
      if (f.estado !== undefined && !ESTADOS_RESERVA.includes(f.estado)) {
        invalido('estado debe ser "confirmada", "cancelada" o "no_presentada"');
      }
      const dias = hasta.dia - desde.dia + 1;
      if (dias > MAXIMO_DIAS_EXPORTACION) {
        throw new ErrorDelClub("RANGO_DEMASIADO_GRANDE", `El periodo abarca ${dias} días y como mucho puede abarcar ${MAXIMO_DIAS_EXPORTACION}`, 400);
      }
      const pistas = new Map(estado.pistas.map((p) => [p.id, p]));
      const socios = new Map(estado.socios.map((s) => [s.id, s]));
      // filter devuelve una copia: ordenarla no cambia el orden de estado.reservas.
      const filas = estado.reservas
        .filter((r) => r.inicio.slice(0, 10) >= desde.fecha && r.inicio.slice(0, 10) <= hasta.fecha && (!f.estado || r.estado === f.estado))
        .sort((a, b) => comparar(a.inicio, b.inicio) || comparar(a.pistaId, b.pistaId))
        .map((r) => [
          r.id,
          r.inicio.slice(0, 10),
          r.inicio.slice(11, 16),
          pistas.get(r.pistaId)?.nombre ?? "",
          socios.get(r.socioId)?.nombre ?? "",
          socios.get(r.socioId)?.email ?? "",
          r.estado,
          euros(r.importe),
          r.penalizacion === undefined ? "" : euros(r.penalizacion),
          r.notas,
        ]);
      const csv = [CABECERA_CSV, ...filas].map((campos) => `${campos.map(campoCsv).join(",")}\r\n`).join("");
      return { fichero: `reservas-${desde.fecha}-${hasta.fecha}.csv`, csv };
    },

    obtenerReserva(id: string) {
      return { reserva: reserva(id) };
    },

    crearReserva(datos: { socioId?: unknown; pistaId?: unknown; inicio?: unknown; notas?: unknown }) {
      const { socioId, pistaId, inicio } = datos;
      if (typeof socioId !== "string" || typeof pistaId !== "string" || typeof inicio !== "string") {
        invalido("socioId, pistaId e inicio son obligatorios");
      }
      if (datos.notas !== undefined && typeof datos.notas !== "string") invalido("notas debe ser un texto");
      const socio = estado.socios.find((s) => s.id === socioId);
      if (!socio) throw new ErrorDelClub("SOCIO_NO_ENCONTRADO", `No existe el socio ${socioId}`, 404);
      const p = pista(pistaId as string);
      if (!FECHA_HORA.test(inicio as string) || !HORAS.includes((inicio as string).slice(11))) {
        throw new ErrorDelClub("FRANJA_INVALIDA", `inicio debe ser AAAA-MM-DDTHH:MM y empezar a una de estas horas: ${HORAS.join(", ")}`, 400);
      }
      if (!socio.cuotaActiva) throw new ErrorDelClub("CUOTA_INACTIVA", `${socio.nombre} no tiene la cuota al día`);
      if (p.estado === "cerrada") throw new ErrorDelClub("PISTA_CERRADA", `${p.nombre} está cerrada`);
      if ((inicio as string) <= estado.ahora) throw new ErrorDelClub("FRANJA_PASADA", "Esa franja ya ha empezado o ha pasado");
      if (ocupada(p.id, inicio as string)) throw new ErrorDelClub("FRANJA_NO_DISPONIBLE", "Esa franja ya está reservada");
      const futuras = estado.reservas.filter((r) => r.socioId === socio.id && r.estado === "confirmada" && r.inicio > estado.ahora);
      if (futuras.length >= MAXIMO_RESERVAS_FUTURAS) {
        throw new ErrorDelClub("LIMITE_DE_RESERVAS", `${socio.nombre} ya tiene ${MAXIMO_RESERVAS_FUTURAS} reservas futuras`);
      }
      estado.contador += 1;
      const nueva: Reserva = {
        id: `R-${String(estado.contador).padStart(4, "0")}`,
        socioId: socio.id,
        pistaId: p.id,
        inicio: inicio as string,
        fin: finDeFranja(inicio as string),
        estado: "confirmada",
        importe: precio(p, inicio as string),
        notas: (datos.notas as string | undefined) ?? "",
      };
      estado.reservas.push(nueva);
      return { reserva: nueva };
    },

    cancelarReserva(id: string, datos: { forzar?: unknown; motivo?: unknown }) {
      const r = reserva(id);
      if (datos.forzar !== undefined && typeof datos.forzar !== "boolean") invalido("forzar debe ser true o false");
      if (r.estado === "cancelada") throw new ErrorDelClub("YA_CANCELADA", "La reserva ya estaba cancelada");
      if (r.inicio <= estado.ahora) throw new ErrorDelClub("RESERVA_PASADA", "La reserva ya ha empezado o ha pasado");
      const horas = horasEntre(estado.ahora, r.inicio);
      if (horas < HORAS_CANCELACION_GRATUITA) {
        if (datos.forzar !== true) {
          throw new ErrorDelClub(
            "FUERA_DE_PLAZO",
            `Faltan ${Math.floor(horas)} horas para la reserva y la cancelación gratuita termina ${HORAS_CANCELACION_GRATUITA} horas antes. ` +
            "Con forzar se cancela con una penalización del 100 % del importe: solo si el socio ha aceptado expresamente la penalización.",
          );
        }
        r.penalizacion = r.importe;
      }
      r.estado = "cancelada";
      if (typeof datos.motivo === "string") r.motivoCancelacion = datos.motivo;
      return { reserva: r };
    },
  };
}

export type Club = ReturnType<typeof crearClub>;
