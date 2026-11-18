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
}

export type EstadoEspera = "activa" | "retirada" | "asignada" | "descartada";

/** Un socio apuntado a la lista de espera de una franja ocupada. */
export interface Espera {
  id: string;
  socioId: string;
  pistaId: string;
  inicio: string;
  estado: EstadoEspera;
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
  /** Las esperas de todas las franjas, por orden de llegada. */
  esperas: Espera[];
  registro: EntradaRegistro[];
  contador: number;
}
