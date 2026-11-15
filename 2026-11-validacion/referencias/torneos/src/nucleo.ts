/// <reference lib="esnext.temporal" />
// Las operaciones del club y sus reglas. La API HTTP (src/servidor.ts) es la única que las llama.
import { finDeFranja, HORAS, precio } from "./semilla.ts";
import type { Estado, EstadoReserva, EstadoTorneo, Inscripcion, Partido, Reserva, Socio, Torneo } from "./tipos.ts";

export class ErrorDelClub extends Error {
  codigo: string;
  http: number;
  /** Datos que la API añade al error, junto a `codigo` y `mensaje` (por ejemplo, los `conflictos` de FRANJAS_OCUPADAS). */
  datos?: Record<string, unknown>;
  constructor(codigo: string, mensaje: string, http = 409, datos?: Record<string, unknown>) {
    super(mensaje);
    this.codigo = codigo;
    this.http = http;
    if (datos) this.datos = datos;
  }
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const FECHA_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export const LIMITE_MAXIMO = 100;
export const LIMITE_POR_DEFECTO = 50;
export const MAXIMO_RESERVAS_FUTURAS = 3;
export const HORAS_CANCELACION_GRATUITA = 24;
export const ZONA_DEL_CLUB = "Europe/Madrid";
/** Un torneo admite de 4 a 16 parejas. */
export const PLAZAS_MINIMAS_TORNEO = 4;
export const PLAZAS_MAXIMAS_TORNEO = 16;
/** Inscribirse y darse de baja de un torneo se puede mientras falten estas horas o más para su primera franja. */
export const HORAS_PLAZO_INSCRIPCION = 48;
const ESTADOS_TORNEO: readonly EstadoTorneo[] = ["inscripcion", "en_juego", "terminado", "cancelado"];

function invalido(mensaje: string): never {
  throw new ErrorDelClub("DATOS_INVALIDOS", mensaje, 400);
}

/** Solo los gestores pueden hacer `accion`: 401 si no se sabe quién llama y 403 si no es gestor. */
function exigirGestor(quien: Socio | undefined, accion: string): void {
  if (!quien) throw new ErrorDelClub("NO_IDENTIFICADO", `Para ${accion} hay que identificarse con la cabecera X-Socio`, 401);
  if (quien.rol !== "gestor") throw new ErrorDelClub("SIN_PERMISO", `Solo un gestor puede ${accion}`, 403);
}

/** Para `accion` hay que saber quién llama: 401 sin cabecera X-Socio. */
function exigirIdentificado(quien: Socio | undefined, accion: string): Socio {
  if (!quien) throw new ErrorDelClub("NO_IDENTIFICADO", `Para ${accion} hay que identificarse con la cabecera X-Socio`, 401);
  return quien;
}

/** Si `inicio` es el de una franja: AAAA-MM-DDTHH:MM, de un día que existe y a una de las horas de las franjas. */
function esInicioDeFranja(inicio: string): boolean {
  if (!FECHA_HORA.test(inicio) || !HORAS.includes(inicio.slice(11))) return false;
  const dia = new Date(`${inicio.slice(0, 10)}T12:00:00Z`);
  return !Number.isNaN(dia.getTime()) && dia.toISOString().slice(0, 10) === inicio.slice(0, 10);
}

/** Una lista no vacía y sin repetidos. Lo que vale cada elemento se comprueba aparte. */
function esListaSinRepetidos(valor: unknown): valor is unknown[] {
  return Array.isArray(valor) && valor.length > 0 && new Set(valor).size === valor.length;
}

/** El instante real de una hora local del club, en milisegundos. */
function instante(local: string): number {
  return Temporal.PlainDateTime.from(local).toZonedDateTime(ZONA_DEL_CLUB).epochMilliseconds;
}

/** Horas reales entre dos horas locales del club, contando el cambio de hora. */
function horasRealesEntre(desde: string, hasta: string): number {
  return (instante(hasta) - instante(desde)) / 3_600_000;
}

/** Un id con prefijo y cuatro cifras, como R-0001. */
function idCon(prefijo: string, n: number): string {
  return `${prefijo}-${String(n).padStart(4, "0")}`;
}

/** El partido de la ronda siguiente al que pasa la ganadora de `p` y su sitio en `parejas`. La final no tiene. */
function destino(partidos: Partido[], p: Partido): { partido: Partido; sitio: 0 | 1 } | undefined {
  const enSuRonda = partidos.filter((x) => x.ronda === p.ronda).length;
  if (enSuRonda === 1) return undefined;
  // El partido j de la ronda siguiente lo juegan la ganadora del j y la del M+1−j de esta, que tiene M partidos.
  const primeraMitad = p.numero <= enSuRonda / 2;
  const numero = primeraMitad ? p.numero : enSuRonda + 1 - p.numero;
  const partido = partidos.find((x) => x.ronda === p.ronda + 1 && x.numero === numero)!;
  return { partido, sitio: primeraMitad ? 0 : 1 };
}

/** Los partidos de la ronda anterior de los que salen las parejas de `p`. En la primera ronda, ninguno. */
function origenes(partidos: Partido[], p: Partido): Partido[] {
  if (p.ronda === 1) return [];
  const enLaAnterior = partidos.filter((x) => x.ronda === p.ronda - 1).length;
  return partidos.filter((x) => x.ronda === p.ronda - 1 && (x.numero === p.numero || x.numero === enLaAnterior + 1 - p.numero));
}

/**
 * El cuadro de eliminación directa de `parejas` (los ids de las inscripciones, por orden de inscripción), con todos
 * los partidos de todas las rondas, por ronda y número. El cuadro tiene T plazas, la menor potencia de 2 que llega al
 * número de parejas. En la primera ronda, el partido i lo juegan la pareja i y la T+1−i y, si la T+1−i no existe, es
 * un descanso que gana la pareja i. Cada ronda siguiente tiene la mitad de partidos, hasta la final. Las ganadoras de
 * los descansos ya ocupan su sitio en la segunda ronda. Los ids de los partidos empiezan en `primerId`.
 */
function generarCuadro(parejas: string[], primerId: number): Partido[] {
  let plazasDelCuadro = 1;
  while (plazasDelCuadro < parejas.length) plazasDelCuadro *= 2;
  let siguienteId = primerId;
  const partido = (ronda: number, numero: number, a: string | null, b: string | null): Partido => ({
    id: idCon("P", siguienteId++), ronda, numero, parejas: [a, b], estado: "pendiente", ganadora: null, marcador: null, pistaId: null, inicio: null,
  });
  const partidos: Partido[] = [];
  for (let i = 1; i <= plazasDelCuadro / 2; i++) {
    const rival = parejas[plazasDelCuadro - i] ?? null; // la pareja T+1−i
    const p = partido(1, i, parejas[i - 1]!, rival);
    if (rival === null) {
      p.estado = "descanso";
      p.ganadora = parejas[i - 1]!;
    }
    partidos.push(p);
  }
  for (let ronda = 2, enLaRonda = plazasDelCuadro / 4; enLaRonda >= 1; ronda++, enLaRonda /= 2) {
    for (let j = 1; j <= enLaRonda; j++) partidos.push(partido(ronda, j, null, null));
  }
  for (const p of partidos) {
    if (p.estado !== "descanso") continue;
    const siguiente = destino(partidos, p)!;
    siguiente.partido.parejas[siguiente.sitio] = p.ganadora;
  }
  return partidos;
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
  const socioPorId = (id: string) => {
    const encontrado = estado.socios.find((s) => s.id === id);
    if (!encontrado) throw new ErrorDelClub("SOCIO_NO_ENCONTRADO", `No existe el socio ${id}`, 404);
    return encontrado;
  };
  const torneo = (id: string) => {
    const encontrado = estado.torneos.find((t) => t.id === id);
    if (!encontrado) throw new ErrorDelClub("TORNEO_NO_ENCONTRADO", `No existe el torneo ${id}`, 404);
    return encontrado;
  };

  /**
   * Las combinaciones de franja y pista que bloquea un torneo: mientras está en inscripción, todas sus franjas en todas
   * sus pistas. Al cerrar, solo las que le tocan a algún partido. Si se cancela, ninguna.
   */
  const bloqueadas = (t: Torneo): { pistaId: string; inicio: string }[] => {
    if (t.estado === "cancelado") return [];
    if (t.estado === "inscripcion") return t.franjas.flatMap((inicio) => t.pistas.map((pistaId) => ({ pistaId, inicio })));
    return t.partidos.flatMap((p) => (p.pistaId !== null && p.inicio !== null ? [{ pistaId: p.pistaId, inicio: p.inicio }] : []));
  };
  /** El torneo que bloquea esa franja en esa pista, si hay alguno. */
  const torneoQueBloquea = (pistaId: string, inicio: string) =>
    estado.torneos.find((t) => bloqueadas(t).some((b) => b.pistaId === pistaId && b.inicio === inicio));

  /** Inscribirse y darse de baja: solo con el torneo en inscripción y mientras falten 48 horas o más para su primera franja. */
  const comprobarPlazo = (t: Torneo) => {
    if (t.estado !== "inscripcion") throw new ErrorDelClub("INSCRIPCION_CERRADA", "La inscripción de este torneo ya está cerrada");
    if (horasRealesEntre(estado.ahora, t.franjas[0]!) < HORAS_PLAZO_INSCRIPCION) {
      throw new ErrorDelClub("INSCRIPCION_CERRADA", `La inscripción se cierra cuando faltan menos de ${HORAS_PLAZO_INSCRIPCION} horas para la primera franja del torneo`);
    }
  };

  /**
   * El calendario: a cada partido que no es un descanso, por orden de ronda y de número, le toca la primera combinación
   * de franja y pista del torneo que no tiene otro partido (la franja más temprana y, en la misma franja, la pista que
   * va antes en `pistas`) cuya franja no ha empezado y empieza a la hora en que terminan, o después, los partidos de la
   * ronda anterior de los que salen sus parejas. Los descansos no cuentan. Si a algún partido no le queda ninguna,
   * 409 FRANJAS_INSUFICIENTES. `partidos` es el cuadro nuevo, que el torneo solo guarda si se programa entero.
   */
  const programar = (t: Torneo, partidos: Partido[]) => {
    const libres = t.franjas.filter((inicio) => inicio > estado.ahora).flatMap((inicio) => t.pistas.map((pistaId) => ({ pistaId, inicio })));
    for (const p of partidos) {
      if (p.estado === "descanso") continue;
      // Los descansos no tienen hora, así que no ponen límite.
      const desde = origenes(partidos, p).flatMap((o) => (o.inicio === null ? [] : [finDeFranja(o.inicio)])).sort().at(-1);
      const k = libres.findIndex((c) => desde === undefined || c.inicio >= desde);
      if (k === -1) throw new ErrorDelClub("FRANJAS_INSUFICIENTES", "No hay franjas y pistas para todos los partidos: el torneo sigue en inscripción");
      const [elegida] = libres.splice(k, 1);
      p.pistaId = elegida!.pistaId;
      p.inicio = elegida!.inicio;
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
            const delTorneo = torneoQueBloquea(p.id, inicio);
            if (delTorneo) return { inicio, fin: finDeFranja(inicio), estado: "torneo", torneoId: delTorneo.id, precio: precio(p, inicio) };
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
      const delTorneo = torneoQueBloquea(p.id, inicio as string);
      if (delTorneo) throw new ErrorDelClub("FRANJA_NO_DISPONIBLE", `Esa franja la bloquea el torneo ${delTorneo.nombre}`);
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

    /**
     * Crea un torneo en inscripción, que bloquea sus franjas en todas sus pistas. Las pistas tienen que estar abiertas,
     * y las franjas, sin reservas confirmadas ni otro torneo que las bloquee (FRANJAS_OCUPADAS, con los `conflictos`).
     * Solo para gestores (`quien` es el socio de la cabecera X-Socio).
     */
    crearTorneo(datos: { nombre?: unknown; pistas?: unknown; franjas?: unknown; plazas?: unknown; cuota?: unknown }, quien: Socio | undefined) {
      exigirGestor(quien, "crear torneos");
      const { nombre, pistas, franjas, plazas, cuota } = datos;
      if (typeof nombre !== "string" || nombre.trim() === "") invalido("nombre es obligatorio y no puede estar vacío");
      if (!esListaSinRepetidos(pistas)) invalido("pistas debe ser una lista no vacía de ids de pista, sin repetidos");
      if (!esListaSinRepetidos(franjas)) invalido("franjas debe ser una lista no vacía de inicios de franja, sin repetidos");
      if (typeof plazas !== "number" || !Number.isInteger(plazas) || plazas < PLAZAS_MINIMAS_TORNEO || plazas > PLAZAS_MAXIMAS_TORNEO) {
        invalido(`plazas debe ser un número entero entre ${PLAZAS_MINIMAS_TORNEO} y ${PLAZAS_MAXIMAS_TORNEO}`);
      }
      if (typeof cuota !== "number" || !Number.isInteger(cuota) || cuota < 0) invalido("cuota debe ser un número entero de céntimos, 0 o más");
      const lasPistas = pistas.map((id) => {
        if (typeof id !== "string") throw new ErrorDelClub("PISTA_NO_ENCONTRADA", `No existe la pista ${JSON.stringify(id)}`, 404);
        return pista(id);
      });
      const inicios = franjas.map((inicio) => {
        if (typeof inicio !== "string" || !esInicioDeFranja(inicio)) {
          throw new ErrorDelClub(
            "FRANJA_INVALIDA",
            `${JSON.stringify(inicio)} no es una franja: tiene que ser AAAA-MM-DDTHH:MM y empezar a una de estas horas: ${HORAS.join(", ")}`,
            400,
          );
        }
        return inicio;
      });
      for (const inicio of inicios) {
        if (inicio <= estado.ahora) throw new ErrorDelClub("FRANJA_PASADA", `La franja ${inicio} ya ha empezado o ha pasado`);
      }
      const cerrada = lasPistas.find((p) => p.estado === "cerrada");
      if (cerrada) throw new ErrorDelClub("PISTA_CERRADA", `${cerrada.nombre} está cerrada`);
      const enOrden = inicios.toSorted();
      const conflictos: ({ pistaId: string; inicio: string } & ({ reservaId: string } | { torneoId: string }))[] = [];
      for (const inicio of enOrden) {
        for (const p of lasPistas) {
          for (const r of estado.reservas) {
            if (r.pistaId === p.id && r.inicio === inicio && r.estado === "confirmada") conflictos.push({ pistaId: p.id, inicio, reservaId: r.id });
          }
          const otro = torneoQueBloquea(p.id, inicio);
          if (otro) conflictos.push({ pistaId: p.id, inicio, torneoId: otro.id });
        }
      }
      if (conflictos.length > 0) {
        throw new ErrorDelClub("FRANJAS_OCUPADAS", "Algunas de esas franjas ya están reservadas o las bloquea otro torneo: no se ha creado nada", 409, { conflictos });
      }
      const nuevo: Torneo = {
        id: idCon("T", estado.torneos.length + 1),
        nombre,
        pistas: lasPistas.map((p) => p.id),
        franjas: enOrden,
        plazas,
        cuota,
        estado: "inscripcion",
        inscripciones: [],
        partidos: [],
        campeona: null,
      };
      estado.torneos.push(nuevo);
      return { torneo: nuevo };
    },

    /** Los torneos, también los cancelados, por orden de su primera franja. Con `filtro`, solo los de ese estado. */
    listarTorneos(filtro: string | undefined) {
      if (filtro !== undefined && !ESTADOS_TORNEO.includes(filtro as EstadoTorneo)) {
        invalido(`estado debe ser ${ESTADOS_TORNEO.map((e) => `"${e}"`).join(", ")}`);
      }
      const torneos = estado.torneos
        .filter((t) => filtro === undefined || t.estado === filtro)
        .toSorted((a, b) => (a.franjas[0]! < b.franjas[0]! ? -1 : a.franjas[0]! > b.franjas[0]! ? 1 : 0))
        .map((t) => ({
          id: t.id,
          nombre: t.nombre,
          estado: t.estado,
          plazas: t.plazas,
          cuota: t.cuota,
          inscritas: t.inscripciones.filter((i) => i.estado === "inscrita").length,
        }));
      return { torneos };
    },

    /** Un torneo, con sus inscripciones y sus partidos. */
    obtenerTorneo(id: string) {
      return { torneo: torneo(id) };
    },

    /**
     * Inscribe a una pareja al final de las inscripciones del torneo, con la cuota del torneo como importe. Puede
     * hacerlo uno de los dos socios de la pareja o un gestor.
     */
    inscribirPareja(torneoId: string, datos: { socios?: unknown }, quien: Socio | undefined) {
      const quienLlama = exigirIdentificado(quien, "inscribir a una pareja");
      const t = torneo(torneoId);
      const { socios } = datos;
      if (!Array.isArray(socios) || socios.length !== 2 || socios.some((s) => typeof s !== "string") || socios[0] === socios[1]) {
        invalido("socios debe ser una lista con los ids de los dos socios de la pareja, distintos");
      }
      const ids = socios as [string, string];
      if (!ids.includes(quienLlama.id) && quienLlama.rol !== "gestor") {
        throw new ErrorDelClub("SIN_PERMISO", "Solo uno de los dos socios de la pareja o un gestor pueden inscribirla", 403);
      }
      const jugadores = ids.map(socioPorId);
      comprobarPlazo(t);
      for (const s of jugadores) {
        if (!s.cuotaActiva) throw new ErrorDelClub("CUOTA_INACTIVA", `${s.nombre} no tiene la cuota al día`);
      }
      const inscritas = t.inscripciones.filter((i) => i.estado === "inscrita");
      for (const s of jugadores) {
        if (inscritas.some((i) => i.socios.includes(s.id))) throw new ErrorDelClub("YA_INSCRITO", `${s.nombre} ya está inscrito en este torneo`);
      }
      if (inscritas.length >= t.plazas) throw new ErrorDelClub("TORNEO_COMPLETO", `El torneo ya tiene sus ${t.plazas} parejas`);
      const todas = estado.torneos.reduce((n, x) => n + x.inscripciones.length, 0);
      const nueva: Inscripcion = { id: idCon("I", todas + 1), socios: [ids[0], ids[1]], estado: "inscrita", importe: t.cuota };
      t.inscripciones.push(nueva);
      return { inscripcion: nueva };
    },

    /**
     * Da de baja a una pareja: la inscripción sigue en el torneo, en estado `baja`, y deja su plaza libre. Puede hacerlo
     * uno de los dos socios de la pareja o un gestor.
     */
    darDeBajaPareja(torneoId: string, inscripcionId: string, quien: Socio | undefined) {
      const quienLlama = exigirIdentificado(quien, "dar de baja a una pareja");
      const t = torneo(torneoId);
      const i = t.inscripciones.find((x) => x.id === inscripcionId);
      if (!i) throw new ErrorDelClub("INSCRIPCION_NO_ENCONTRADA", `No existe la inscripción ${inscripcionId} en el torneo ${t.id}`, 404);
      if (!i.socios.includes(quienLlama.id) && quienLlama.rol !== "gestor") {
        throw new ErrorDelClub("SIN_PERMISO", "Solo uno de los dos socios de la pareja o un gestor pueden darla de baja", 403);
      }
      if (i.estado === "baja") throw new ErrorDelClub("YA_DE_BAJA", "Esa pareja ya estaba dada de baja");
      comprobarPlazo(t);
      i.estado = "baja";
      return { inscripcion: i };
    },

    /**
     * Cierra la inscripción: genera el cuadro y el calendario y pasa el torneo a `en_juego`. Las combinaciones de franja y
     * pista que no le tocan a ningún partido dejan de estar bloqueadas. Solo para gestores.
     */
    cerrarTorneo(torneoId: string, quien: Socio | undefined) {
      exigirGestor(quien, "cerrar torneos");
      const t = torneo(torneoId);
      if (t.estado !== "inscripcion") throw new ErrorDelClub("TORNEO_NO_EN_INSCRIPCION", "Solo se cierra un torneo que está en inscripción");
      const parejas = t.inscripciones.filter((i) => i.estado === "inscrita").map((i) => i.id);
      if (parejas.length < 2) throw new ErrorDelClub("PAREJAS_INSUFICIENTES", "Para cerrar la inscripción hacen falta al menos 2 parejas inscritas");
      const yaCreados = estado.torneos.reduce((n, x) => n + x.partidos.length, 0);
      const partidos = generarCuadro(parejas, yaCreados + 1);
      programar(t, partidos);
      t.partidos = partidos;
      t.estado = "en_juego";
      return { torneo: t };
    },

    /**
     * Apunta (o corrige) el resultado de un partido. La ganadora pasa al partido de la ronda siguiente y, si es la final,
     * es la campeona y el torneo termina. Solo para gestores.
     */
    apuntarResultado(torneoId: string, partidoId: string, datos: { ganadora?: unknown; marcador?: unknown }, quien: Socio | undefined) {
      exigirGestor(quien, "apuntar resultados");
      const t = torneo(torneoId);
      if (t.estado !== "en_juego") throw new ErrorDelClub("TORNEO_NO_EN_JUEGO", "Solo se apuntan resultados con el torneo en juego");
      const p = t.partidos.find((x) => x.id === partidoId);
      if (!p) throw new ErrorDelClub("PARTIDO_NO_ENCONTRADO", `No existe el partido ${partidoId} en el torneo ${t.id}`, 404);
      if (p.estado === "descanso" || p.parejas[0] === null || p.parejas[1] === null) {
        throw new ErrorDelClub("PARTIDO_NO_LISTO", p.estado === "descanso" ? "Es un descanso: no se juega" : "Todavía no se saben las dos parejas del partido");
      }
      const { ganadora, marcador } = datos;
      if (typeof ganadora !== "string" || !p.parejas.includes(ganadora)) invalido("ganadora debe ser el id de una de las dos parejas del partido");
      if (marcador !== undefined && marcador !== null && typeof marcador !== "string") invalido("marcador debe ser un texto");
      if (p.inicio! > estado.ahora) throw new ErrorDelClub("PARTIDO_NO_EMPEZADO", `El partido empieza el ${p.inicio}`);
      const siguiente = destino(t.partidos, p);
      if (p.estado === "jugado" && siguiente?.partido.estado === "jugado") {
        throw new ErrorDelClub("RESULTADO_CERRADO", "El partido de la ronda siguiente ya se ha jugado: este resultado ya no se puede cambiar");
      }
      p.estado = "jugado";
      p.ganadora = ganadora;
      p.marcador = (marcador as string | null | undefined) ?? null;
      if (siguiente) {
        siguiente.partido.parejas[siguiente.sitio] = ganadora;
      } else {
        t.estado = "terminado";
        t.campeona = ganadora;
      }
      return { partido: p };
    },

    /** Cancela un torneo, también si está en juego, y libera todas sus franjas. Solo para gestores. */
    cancelarTorneo(torneoId: string, quien: Socio | undefined) {
      exigirGestor(quien, "cancelar torneos");
      const t = torneo(torneoId);
      if (t.estado === "terminado") throw new ErrorDelClub("TORNEO_TERMINADO", "El torneo ya ha terminado: no se puede cancelar");
      if (t.estado === "cancelado") throw new ErrorDelClub("YA_CANCELADO", "El torneo ya estaba cancelado");
      t.estado = "cancelado";
      return { torneo: t };
    },
  };
}

export type Club = ReturnType<typeof crearClub>;
