// Las operaciones del club y sus reglas. La API HTTP (src/servidor.ts) es la única que las llama.
import { APERTURA, CIERRE, DURACIONES, finDeFranja, HORAS, importeReserva, MINUTOS_FRANJA, minutosDelDia, precio, sumarMinutos } from "./semilla.ts";
import type { Estado, EstadoReserva, Reserva } from "./tipos.ts";

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

function invalido(mensaje: string): never {
  throw new ErrorDelClub("DATOS_INVALIDOS", mensaje, 400);
}

function sinAcentos(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Empieza en punto o y media, no antes de la apertura, y termina como muy tarde al cierre. */
function esInicioValido(inicio: string, duracion: number): boolean {
  if (!FECHA_HORA.test(inicio) || !["00", "30"].includes(inicio.slice(14))) return false;
  const desde = minutosDelDia(inicio.slice(11));
  return desde >= minutosDelDia(APERTURA) && desde + duracion <= minutosDelDia(CIERRE);
}

/** La reserva tal como la devuelve la API: con su duración, también las que ya existían, que son de 90 minutos. */
function conDuracion(r: Reserva): Reserva {
  return { ...r, duracion: r.duracion ?? MINUTOS_FRANJA };
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
  /** Las reservas confirmadas de la pista que se solapan con [inicio, fin). Terminar justo cuando empieza otra no es solaparse. */
  const solapadas = (pistaId: string, inicio: string, fin: string) =>
    estado.reservas.filter((r) => r.pistaId === pistaId && r.estado === "confirmada" && r.inicio < fin && inicio < r.fin);
  /** Los intervalos libres más largos posibles de la pista entre la apertura y el cierre de ese día, ordenados por hora. */
  const huecos = (pistaId: string, fecha: string) => {
    const cierre = `${fecha}T${CIERRE}`;
    let desde = `${fecha}T${APERTURA}`;
    const libres: { inicio: string; fin: string }[] = [];
    for (const r of solapadas(pistaId, desde, cierre).sort((a, b) => a.inicio.localeCompare(b.inicio))) {
      if (r.inicio > desde) libres.push({ inicio: desde, fin: r.inicio });
      if (r.fin > desde) desde = r.fin;
    }
    if (desde < cierre) libres.push({ inicio: desde, fin: cierre });
    return libres;
  };

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
            const fin = finDeFranja(inicio);
            return {
              inicio,
              fin,
              estado: p.estado === "cerrada" ? "cerrada" : solapadas(p.id, inicio, fin).length > 0 ? "reservada" : "libre",
              precio: precio(p, inicio),
            };
          }),
          huecos: p.estado === "cerrada" ? [] : huecos(p.id, fecha),
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
      return { total: todas.length, pagina, paginas, reservas: todas.slice((pagina - 1) * limite, pagina * limite).map(conDuracion) };
    },

    obtenerReserva(id: string) {
      return { reserva: conDuracion(reserva(id)) };
    },

    crearReserva(datos: { socioId?: unknown; pistaId?: unknown; inicio?: unknown; notas?: unknown; duracion?: unknown }) {
      const { socioId, pistaId, inicio } = datos;
      if (typeof socioId !== "string" || typeof pistaId !== "string" || typeof inicio !== "string") {
        invalido("socioId, pistaId e inicio son obligatorios");
      }
      if (datos.notas !== undefined && typeof datos.notas !== "string") invalido("notas debe ser un texto");
      const duracion = datos.duracion === undefined ? MINUTOS_FRANJA : datos.duracion;
      if (typeof duracion !== "number" || !DURACIONES.includes(duracion)) {
        throw new ErrorDelClub("DURACION_INVALIDA", "duracion debe ser 60, 90 o 120 (minutos)", 400);
      }
      const socio = estado.socios.find((s) => s.id === socioId);
      if (!socio) throw new ErrorDelClub("SOCIO_NO_ENCONTRADO", `No existe el socio ${socioId}`, 404);
      const p = pista(pistaId as string);
      if (!esInicioValido(inicio as string, duracion)) {
        throw new ErrorDelClub(
          "FRANJA_INVALIDA",
          `inicio debe ser AAAA-MM-DDTHH:MM, en punto o y media y desde las ${APERTURA}, y la reserva tiene que terminar como muy tarde a las ${CIERRE}`,
          400,
        );
      }
      const fin = sumarMinutos(inicio as string, duracion);
      if (!socio.cuotaActiva) throw new ErrorDelClub("CUOTA_INACTIVA", `${socio.nombre} no tiene la cuota al día`);
      if (p.estado === "cerrada") throw new ErrorDelClub("PISTA_CERRADA", `${p.nombre} está cerrada`);
      if ((inicio as string) <= estado.ahora) throw new ErrorDelClub("FRANJA_PASADA", "Esa franja ya ha empezado o ha pasado");
      if (solapadas(p.id, inicio as string, fin).length > 0) {
        throw new ErrorDelClub("FRANJA_NO_DISPONIBLE", "La pista ya está reservada a esa hora");
      }
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
        fin,
        duracion,
        estado: "confirmada",
        importe: importeReserva(p, inicio as string, duracion),
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
      return { reserva: conDuracion(r) };
    },
  };
}

export type Club = ReturnType<typeof crearClub>;
