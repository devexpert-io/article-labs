// Las operaciones del club y sus reglas. La API HTTP (src/servidor.ts) es la única que las llama.
import { diaDeLaSemana, finDeFranja, HORAS, precio } from "./semilla.ts";
import type { CodigoDescuento, Estado, EstadoReserva, Reserva } from "./tipos.ts";

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

// Catálogo de códigos de descuento. Es fijo: no se crea ni se edita por la API.
export const CODIGOS: readonly CodigoDescuento[] = ["BIENVENIDA", "MANANAS", "CLUB10"];
/** BIENVENIDA vale en reservas hechas hasta este día incluido, según la hora del club. */
export const ULTIMO_DIA_BIENVENIDA = "2026-12-31";
/** MANANAS descuenta 4,00 € en franjas de lunes a viernes que empiezan antes de esta hora. */
export const DESCUENTO_MANANAS = 400;
export const HORA_FIN_MANANAS = "12:00";
/** Reservas con CLUB10 que puede tener cada socio, entre confirmadas y no presentadas. */
export const MAXIMO_RESERVAS_CLUB10 = 3;

function invalido(mensaje: string): never {
  throw new ErrorDelClub("DATOS_INVALIDOS", mensaje, 400);
}

function noAplicable(mensaje: string): never {
  throw new ErrorDelClub("CODIGO_NO_APLICABLE", mensaje);
}

/** Pasa lo que escribió el socio a un código del catálogo: sin espacios alrededor y en mayúsculas. */
function leerCodigo(texto: string): CodigoDescuento {
  const codigo = texto.trim().toUpperCase();
  const encontrado = CODIGOS.find((c) => c === codigo);
  if (!encontrado) throw new ErrorDelClub("CODIGO_INVALIDO", `El código ${texto.trim()} no existe`, 400);
  return encontrado;
}

function porcentaje(importe: number, tanto: number): number {
  return Math.round((importe * tanto) / 100);
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

  /** Lo que descuenta el código en esta reserva, o CODIGO_NO_APLICABLE si no cumple sus condiciones. */
  const descuentoDe = (codigo: CodigoDescuento, socioId: string, inicio: string, importeBase: number): number => {
    switch (codigo) {
      case "BIENVENIDA":
        if (estado.reservas.some((r) => r.socioId === socioId)) {
          noAplicable("BIENVENIDA solo vale en la primera reserva del socio");
        }
        if (estado.ahora.slice(0, 10) > ULTIMO_DIA_BIENVENIDA) {
          noAplicable("BIENVENIDA solo vale en reservas hechas hasta el 31 de diciembre de 2026");
        }
        return porcentaje(importeBase, 50);
      case "MANANAS": {
        const dia = diaDeLaSemana(inicio.slice(0, 10));
        if (dia === 0 || dia === 6 || inicio.slice(11) >= HORA_FIN_MANANAS) {
          noAplicable("MANANAS solo vale en franjas de lunes a viernes que empiezan antes de las 12:00");
        }
        return DESCUENTO_MANANAS;
      }
      case "CLUB10": {
        const conClub10 = estado.reservas.filter((r) =>
          r.socioId === socioId && r.codigo === "CLUB10" && (r.estado === "confirmada" || r.estado === "no_presentada"));
        if (conClub10.length >= MAXIMO_RESERVAS_CLUB10) {
          noAplicable(`Cada socio puede tener como mucho ${MAXIMO_RESERVAS_CLUB10} reservas con CLUB10`);
        }
        return porcentaje(importeBase, 10);
      }
    }
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

    obtenerReserva(id: string) {
      return { reserva: reserva(id) };
    },

    crearReserva(datos: { socioId?: unknown; pistaId?: unknown; inicio?: unknown; notas?: unknown; codigo?: unknown }) {
      const { socioId, pistaId, inicio } = datos;
      if (typeof socioId !== "string" || typeof pistaId !== "string" || typeof inicio !== "string") {
        invalido("socioId, pistaId e inicio son obligatorios");
      }
      if (datos.notas !== undefined && typeof datos.notas !== "string") invalido("notas debe ser un texto");
      if (datos.codigo !== undefined && typeof datos.codigo !== "string") invalido("codigo debe ser un texto");
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
      // Las reglas del club van primero: el código solo se mira cuando la reserva se puede hacer.
      const importeBase = precio(p, inicio as string);
      const codigo = datos.codigo === undefined ? undefined : leerCodigo(datos.codigo as string);
      const descuento = codigo ? Math.min(importeBase, descuentoDe(codigo, socio.id, inicio as string, importeBase)) : 0;
      estado.contador += 1;
      const nueva: Reserva = {
        id: `R-${String(estado.contador).padStart(4, "0")}`,
        socioId: socio.id,
        pistaId: p.id,
        inicio: inicio as string,
        fin: finDeFranja(inicio as string),
        estado: "confirmada",
        importeBase,
        descuento,
        importe: importeBase - descuento,
        ...(codigo ? { codigo } : {}),
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
        // importe es lo que paga el socio: ya lleva el descuento, si lo hubo.
        r.penalizacion = r.importe;
      }
      r.estado = "cancelada";
      if (typeof datos.motivo === "string") r.motivoCancelacion = datos.motivo;
      return { reserva: r };
    },
  };
}

export type Club = ReturnType<typeof crearClub>;
