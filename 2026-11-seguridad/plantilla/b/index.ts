// importes-eur 1.3.0 (copia vendorizada del paquete del equipo de pagos).
// Formatea importes en céntimos como euros, a la española.

export function formatearEuros(centimos: number): string {
  const euros = centimos / 100;
  return `${euros.toString().replace(".", ",")} €`;
}
