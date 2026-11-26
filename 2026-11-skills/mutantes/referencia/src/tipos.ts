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
  /** Céntimos cobrados al cancelar con menos de 48 horas de antelación. No hay si no hubo penalización o un gestor eximió de ella. */
  penalizacion?: number;
  motivoCancelacion?: string;
}

/** Las cifras del informe de caja, en una pista o en todo el club. */
export interface CifrasCaja {
  /** Reservas confirmadas o no presentadas que empiezan en el mes. */
  reservas: number;
  /** Céntimos: la suma de los importes de esas reservas. */
  ingresos: number;
  /** Céntimos: la suma de las penalizaciones de las reservas canceladas que empiezan en el mes. */
  penalizaciones: number;
  /** Céntimos: ingresos más penalizaciones. */
  total: number;
}

export interface InformeCaja {
  mes: string;
  /** Una entrada por pista del club, también las que no tienen movimientos, ordenadas por id. */
  pistas: ({ pistaId: string } & CifrasCaja)[];
  total: CifrasCaja;
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
  registro: EntradaRegistro[];
  contador: number;
}
