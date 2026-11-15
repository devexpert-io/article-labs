function instanteMadrid(local: string): number {
  const [fecha, hora] = local.split("T");
  const [y, m, d] = fecha!.split("-").map(Number);
  const [hh, mm] = hora!.split(":").map(Number);
  const utc = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  const partes = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", timeZoneName: "shortOffset", hour: "2-digit" }).formatToParts(new Date(utc));
  const zona = partes.find((p) => p.type === "timeZoneName")!.value;
  const match = zona.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  const offset = match ? (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3] ?? 0)) : 0;
  return utc - offset * 60_000;
}

const casos = ["2027-03-28T00:30", "2027-03-28T01:00", "2027-03-28T01:30", "2027-03-28T01:59", "2027-03-28T03:00", "2027-03-29T09:00", "2027-10-31T00:30", "2027-10-31T01:30", "2027-10-31T03:00", "2027-11-01T09:00"];
for (const c of casos) console.log(c, "->", new Date(instanteMadrid(c)).toISOString());
const h = (a: string, b: string) => (instanteMadrid(b) - instanteMadrid(a)) / 3600000;
console.log("horas 2027-03-28T01:30 -> 2027-03-29T09:00:", h("2027-03-28T01:30", "2027-03-29T09:00"), "(reales 30,5)");
console.log("horas 2027-10-31T01:30 -> 2027-11-01T09:00:", h("2027-10-31T01:30", "2027-11-01T09:00"), "(reales 32,5)");
console.log("horas 2027-03-26T20:30 -> 2027-03-28T21:00:", h("2027-03-26T20:30", "2027-03-28T21:00"), "(reales 47,5)");
