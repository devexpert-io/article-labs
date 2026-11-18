// Arranca la API del club en un puerto libre para los tests y da un atajo para llamarla.
import { spawn, type ChildProcess } from "node:child_process";

export interface Api {
  base: string;
  proceso: ChildProcess;
  /** Llama a la API. Devuelve el código HTTP, las cabeceras y el cuerpo (JSON si lo es, texto si no). */
  pedir(metodo: string, ruta: string, opciones?: { cuerpo?: unknown; socio?: string }): Promise<Respuesta>;
  cerrar(): void;
}

export interface Respuesta {
  status: number;
  cabeceras: Headers;
  cuerpo: any;
  texto: string;
}

export async function arrancarApi(entorno: Record<string, string> = {}): Promise<Api> {
  const proceso = spawn("node", ["src/servidor.ts"], { env: { ...process.env, PORT: "0", ...entorno } });
  const base = await new Promise<string>((resolver, rechazar) => {
    proceso.once("exit", (codigo) => rechazar(new Error(`La API terminó con código ${codigo}`)));
    proceso.stdout!.on("data", (trozo: Buffer) => {
      const puerto = /PUERTO=(\d+)/.exec(trozo.toString())?.[1];
      if (puerto) resolver(`http://127.0.0.1:${puerto}`);
    });
  });
  return {
    base,
    proceso,
    async pedir(metodo, ruta, opciones = {}) {
      const cabeceras: Record<string, string> = {};
      if (opciones.cuerpo !== undefined) cabeceras["content-type"] = "application/json";
      if (opciones.socio) cabeceras["x-socio"] = opciones.socio;
      const r = await fetch(`${base}${ruta}`, {
        method: metodo,
        headers: cabeceras,
        body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
      });
      const texto = await r.text();
      let cuerpo: unknown = texto;
      try {
        cuerpo = JSON.parse(texto);
      } catch {
        // No es JSON: se queda como texto.
      }
      return { status: r.status, cabeceras: r.headers, cuerpo, texto };
    },
    cerrar() {
      proceso.kill();
    },
  };
}
