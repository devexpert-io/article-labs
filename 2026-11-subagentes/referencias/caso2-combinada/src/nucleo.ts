// Las operaciones del club y sus reglas. La API HTTP (src/servidor.ts) es la única que las llama.
import { diaDeLaSemana, finDeFranja, HORAS, precio } from "./semilla.ts";
import type { CodigoDescuento, Espera, Estado, EstadoReserva, Pista, Reserva, Socio } from "./tipos.ts";

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

// Catálogo de códigos de descuento. Es fijo: no se crea ni se edita por la API.
export const CODIGOS: readonly CodigoDescuento[] = ["BIENVENIDA", "MANANAS", "CLUB10"];
/** BIENVENIDA vale en reservas hechas hasta este día incluido, según la hora del club. */
export const ULTIMO_DIA_BIENVENIDA = "2026-12-31";
/** MANANAS descuenta 4,00 € en franjas de lunes a viernes que empiezan antes de esta hora. */
export const DESCUENTO_MANANAS = 400;
export const HORA_FIN_MANANAS = "12:00";
/** Reservas con CLUB10 que puede tener cada socio, entre confirmadas y no presentadas. */
export const MAXIMO_RESERVAS_CLUB10 = 3;
export const MAXIMO_ESPERAS_ACTIVAS = 2;
export const NOTA_ASIGNADA = "Asignada desde la lista de espera";

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
  const reservaDeLaFranja = (pistaId: string, inicio: string) =>
    estado.reservas.find((r) => r.pistaId === pistaId && r.inicio === inicio && r.estado === "confirmada");
  const ocupada = (pistaId: string, inicio: string) => reservaDeLaFranja(pistaId, inicio) !== undefined;
  const reservasFuturas = (socioId: string) =>
    estado.reservas.filter((r) => r.socioId === socioId && r.estado === "confirmada" && r.inicio > estado.ahora).length;

  /** Las comprobaciones de reservar que valen también para apuntarse a la lista de espera de una franja. */
  const comprobarFranja = (socio: Socio, pistaId: string, inicio: string): Pista => {
    const p = pista(pistaId);
    if (!FECHA_HORA.test(inicio) || !HORAS.includes(inicio.slice(11))) {
      throw new ErrorDelClub("FRANJA_INVALIDA", `inicio debe ser AAAA-MM-DDTHH:MM y empezar a una de estas horas: ${HORAS.join(", ")}`, 400);
    }
    if (!socio.cuotaActiva) throw new ErrorDelClub("CUOTA_INACTIVA", `${socio.nombre} no tiene la cuota al día`);
    if (p.estado === "cerrada") throw new ErrorDelClub("PISTA_CERRADA", `${p.nombre} está cerrada`);
    if (inicio <= estado.ahora) throw new ErrorDelClub("FRANJA_PASADA", "Esa franja ya ha empezado o ha pasado");
    return p;
  };

  const nuevaReserva = (socioId: string, p: Pista, inicio: string, notas: string, codigo?: CodigoDescuento, descuento = 0): Reserva => {
    const importeBase = precio(p, inicio);
    estado.contador += 1;
    const nueva: Reserva = {
      id: `R-${String(estado.contador).padStart(4, "0")}`,
      socioId,
      pistaId: p.id,
      inicio,
      fin: finDeFranja(inicio),
      estado: "confirmada",
      importeBase,
      descuento,
      importe: importeBase - descuento,
      ...(codigo ? { codigo } : {}),
      notas,
    };
    estado.reservas.push(nueva);
    return nueva;
  };

  /** Una espera sigue en la lista mientras está activa y su franja no ha empezado. Cuando empieza, caduca. */
  const vigente = (e: Espera) => e.estado === "activa" && e.inicio > estado.ahora;
  const listaDeEspera = (pistaId: string, inicio: string) =>
    estado.esperas.filter((e) => vigente(e) && e.pistaId === pistaId && e.inicio === inicio);
  /** Cómo se ve una espera desde fuera: mientras está en la lista, con su posición (orden de llegada, desde 1). */
  const verEspera = (e: Espera) =>
    vigente(e) ? { ...e, posicion: listaDeEspera(e.pistaId, e.inicio).indexOf(e) + 1 } : { ...e };

  /** Da la franja al primero de su lista que pueda reservar. A quien no podría (cuota o límite de reservas), lo descarta. */
  const asignarDesdeLaLista = (pistaId: string, inicio: string): Reserva | undefined => {
    for (const e of listaDeEspera(pistaId, inicio)) {
      const socio = estado.socios.find((s) => s.id === e.socioId);
      if (!socio?.cuotaActiva || reservasFuturas(e.socioId) >= MAXIMO_RESERVAS_FUTURAS) {
        e.estado = "descartada";
        continue;
      }
      e.estado = "asignada";
      return nuevaReserva(e.socioId, pista(pistaId), inicio, NOTA_ASIGNADA);
    }
    return undefined;
  };

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

    crearReserva(datos: { socioId?: unknown; pistaId?: unknown; inicio?: unknown; notas?: unknown; codigo?: unknown }) {
      const { socioId, pistaId, inicio } = datos;
      if (typeof socioId !== "string" || typeof pistaId !== "string" || typeof inicio !== "string") {
        invalido("socioId, pistaId e inicio son obligatorios");
      }
      if (datos.notas !== undefined && typeof datos.notas !== "string") invalido("notas debe ser un texto");
      if (datos.codigo !== undefined && typeof datos.codigo !== "string") invalido("codigo debe ser un texto");
      const socio = estado.socios.find((s) => s.id === socioId);
      if (!socio) throw new ErrorDelClub("SOCIO_NO_ENCONTRADO", `No existe el socio ${socioId}`, 404);
      const p = comprobarFranja(socio, pistaId as string, inicio as string);
      if (ocupada(p.id, inicio as string)) throw new ErrorDelClub("FRANJA_NO_DISPONIBLE", "Esa franja ya está reservada");
      if (reservasFuturas(socio.id) >= MAXIMO_RESERVAS_FUTURAS) {
        throw new ErrorDelClub("LIMITE_DE_RESERVAS", `${socio.nombre} ya tiene ${MAXIMO_RESERVAS_FUTURAS} reservas futuras`);
      }
      // Las reglas del club van primero: el código solo se mira cuando la reserva se puede hacer.
      const importeBase = precio(p, inicio as string);
      const codigo = datos.codigo === undefined ? undefined : leerCodigo(datos.codigo as string);
      const descuento = codigo ? Math.min(importeBase, descuentoDe(codigo, socio.id, inicio as string, importeBase)) : 0;
      return { reserva: nuevaReserva(socio.id, p, inicio as string, (datos.notas as string | undefined) ?? "", codigo, descuento) };
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
      const asignada = asignarDesdeLaLista(r.pistaId, r.inicio);
      return { reserva: r, asignadaA: asignada?.id ?? null };
    },

    /** Apunta a `socio` (quien llama) a la lista de espera de una franja ocupada. */
    crearEspera(socio: Socio, datos: { pistaId?: unknown; inicio?: unknown }) {
      const { pistaId, inicio } = datos;
      if (typeof pistaId !== "string" || typeof inicio !== "string") invalido("pistaId e inicio son obligatorios");
      const p = comprobarFranja(socio, pistaId as string, inicio as string);
      const titular = reservaDeLaFranja(p.id, inicio as string);
      if (!titular) throw new ErrorDelClub("FRANJA_LIBRE", "Esa franja está libre: se puede reservar directamente");
      if (titular.socioId === socio.id) throw new ErrorDelClub("YA_RESERVADA", `${socio.nombre} ya tiene reservada esa franja`);
      if (listaDeEspera(p.id, inicio as string).some((e) => e.socioId === socio.id)) {
        throw new ErrorDelClub("YA_EN_ESPERA", `${socio.nombre} ya está en la lista de espera de esa franja`);
      }
      if (estado.esperas.filter((e) => e.socioId === socio.id && vigente(e)).length >= MAXIMO_ESPERAS_ACTIVAS) {
        throw new ErrorDelClub("LIMITE_DE_ESPERAS", `${socio.nombre} ya tiene ${MAXIMO_ESPERAS_ACTIVAS} esperas activas`);
      }
      const espera: Espera = {
        id: `E-${String(estado.esperas.length + 1).padStart(4, "0")}`,
        socioId: socio.id,
        pistaId: p.id,
        inicio: inicio as string,
        estado: "activa",
      };
      estado.esperas.push(espera);
      return { espera: verEspera(espera) };
    },

    /** Las esperas activas de `quien` o, si es gestor, las del socio `socioId`. */
    listarEsperas(quien: Socio, socioId?: string) {
      let de = quien;
      if (socioId !== undefined && socioId !== quien.id) {
        if (quien.rol !== "gestor") throw new ErrorDelClub("SIN_PERMISO", "Solo un gestor puede consultar las esperas de otro socio", 403);
        const otro = estado.socios.find((s) => s.id === socioId);
        if (!otro) throw new ErrorDelClub("SOCIO_NO_ENCONTRADO", `No existe el socio ${socioId}`, 404);
        de = otro;
      }
      return { esperas: estado.esperas.filter((e) => e.socioId === de.id && vigente(e)).map(verEspera) };
    },

    /** Retira una espera activa. Puede hacerlo su dueño o un gestor. */
    retirarEspera(quien: Socio, id: string) {
      const e = estado.esperas.find((x) => x.id === id);
      if (!e) throw new ErrorDelClub("ESPERA_NO_ENCONTRADA", `No existe la espera ${id}`, 404);
      if (e.socioId !== quien.id && quien.rol !== "gestor") {
        throw new ErrorDelClub("SIN_PERMISO", "Solo su dueño o un gestor pueden retirar una espera", 403);
      }
      if (!vigente(e)) throw new ErrorDelClub("ESPERA_NO_ACTIVA", "Esa espera ya no está en la lista");
      e.estado = "retirada";
      return { espera: verEspera(e) };
    },
  };
}

export type Club = ReturnType<typeof crearClub>;
