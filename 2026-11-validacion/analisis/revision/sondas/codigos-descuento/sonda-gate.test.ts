// Sonda: ejecuta el gate del agente (npm run check) dentro de la copia del estado y resume el resultado.
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("sonda: npm run check del estado", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync("npm", ["run", "check"], { encoding: "utf8", timeout: 240_000, env });
  const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const lineas = salida.split("\n");
  const interesantes = lineas.filter((l) => /^\s*(✔|✖|ℹ (tests|pass|fail))|not ok|error TS|Error|AssertionError|TypeError|expected|actual|at .*test\/.*\.test\.ts/.test(l));
  console.log("GATE rc =", r.status);
  console.log(interesantes.slice(0, 120).map((l) => `GATE ${l}`).join("\n"));
});
