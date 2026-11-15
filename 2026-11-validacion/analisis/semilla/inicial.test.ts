import { test } from "node:test";
import { arrancarApi } from "./ayuda.ts";

test("estado inicial", { timeout: 60_000 }, async () => {
  const api = await arrancarApi({ TZ: "UTC" });
  try {
    const r = await api.pedir("GET", "/_estado");
    console.log("@@INICIO@@" + JSON.stringify(r.cuerpo) + "@@FIN@@");
  } finally {
    api.cerrar();
  }
});
