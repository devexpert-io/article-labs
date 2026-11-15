export interface Pista {
  id: string;
  nombre: string;
  tipo: "cristal" | "muro";
  cubierta: boolean;
  estado: "operativa" | "cerrada";
  /** Céntimos de euro por franja. */
  precioValle: number;
  precioPunta: number;
}

export interface Socio {
  id: string;
  nombre: string;
  email: string;
  cuotaActiva: boolean;
  rol: "socio" | "gestor";
  /** Nivel de juego, de 1 a 7 en pasos de 0,5. null si el socio no lo ha fijado. */
  nivel: number | null;
}

export type EstadoReserva = "confirmada" | "cancelada" | "no_presentada";

export interface Reserva {
  id: string;
  socioId: string;
  pistaId: string;
  inicio: string;
  fin: string;
  estado: EstadoReserva;
  /** Céntimos de euro. */
  importe: number;
  notas: string;
  /** Céntimos cobrados al cancelar fuera de plazo. */
  penalizacion?: number;
  motivoCancelacion?: string;
  /** El partido abierto de la reserva. Las reservas normales no lo llevan. */
  partidoId?: string;
}

export type EstadoPartido = "abierto" | "completo" | "cancelado";

/** Lo que paga un jugador que sale de un partido con menos de 24 horas. */
export interface Penalizacion {
  socioId: string;
  /** Céntimos de euro. */
  importe: number;
}

/** Un partido abierto: un socio reserva una pista y los demás jugadores se apuntan hasta ser 4. */
export interface Partido {
  id: string;
  /** La reserva de la pista, a nombre del organizador. */
  reservaId: string;
  pistaId: string;
  inicio: string;
  fin: string;
  /** El id del socio que lo organiza. */
  organizador: string;
  /** Los ids de los socios que juegan: primero el organizador y después por orden de llegada. */
  jugadores: string[];
  plazasLibres: number;
  /** El rango de nivel que admite el partido, extremos incluidos. Sin rango, null los dos. */
  nivelMin: number | null;
  nivelMax: number | null;
  estado: EstadoPartido;
  /** Céntimos de euro: el importe de la reserva. */
  importe: number;
  /** Céntimos de euro: la cuarta parte del importe, redondeada hacia arriba. */
  importePorJugador: number;
  penalizaciones: Penalizacion[];
  /** Solo en los partidos cancelados: por el organizador (o un gestor) o porque no se llenó a tiempo. */
  motivo?: "organizador" | "incompleto";
}

export interface EntradaRegistro {
  n: number;
  operacion: string;
  argumentos: unknown;
  ok: boolean;
  codigo?: string;
}

export interface Estado {
  ahora: string;
  pistas: Pista[];
  socios: Socio[];
  reservas: Reserva[];
  partidos: Partido[];
  registro: EntradaRegistro[];
  contador: number;
}
