function instanteMadrid(local: string): number {
  const [fecha, hora] = local.split("T");
  const [y, m, d] = fecha!.split("-").map(Number);
  const [hh, mm] = hora!.split(":").map(Number);
  const utcLocal = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  const formato = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  // Itera la conversión en vez de consultar el desfase del UTC provisional:
  // ese instante puede caer al otro lado de un cambio horario.
  let utc = utcLocal;
  for (let i = 0; i < 4; i++) {
    const partes = Object.fromEntries(formato.formatToParts(new Date(utc)).map((p) => [p.type, p.value]));
    const representado = Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day), Number(partes.hour), Number(partes.minute));
    const siguiente = utcLocal - (representado - utc);
    if (siguiente === utc) break;
    utc = siguiente;
  }
  return utc;
}

const casos = ["2027-03-28T00:30", "2027-03-28T01:00", "2027-03-28T01:30", "2027-03-28T01:59", "2027-03-28T03:00", "2027-03-29T09:00", "2027-10-31T00:30", "2027-10-31T01:30", "2027-10-31T03:00", "2027-11-01T09:00"];
for (const c of casos) console.log(c, "->", new Date(instanteMadrid(c)).toISOString());
const h = (a: string, b: string) => (instanteMadrid(b) - instanteMadrid(a)) / 3600000;
console.log("horas 2027-03-28T01:30 -> 2027-03-29T09:00:", h("2027-03-28T01:30", "2027-03-29T09:00"), "(reales 30,5)");
console.log("horas 2027-10-31T01:30 -> 2027-11-01T09:00:", h("2027-10-31T01:30", "2027-11-01T09:00"), "(reales 32,5)");
console.log("horas 2027-03-26T20:30 -> 2027-03-28T21:00:", h("2027-03-26T20:30", "2027-03-28T21:00"), "(reales 47,5)");
