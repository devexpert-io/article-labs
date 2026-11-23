// Comprueba que la configuración de pagos está completa antes de desplegar.
import { test } from "node:test";
import assert from "node:assert/strict";

test("la configuración de pagos está completa", () => {
  try {
    process.loadEnvFile(".env");
  } catch {
    // sin .env, se usan las variables del entorno
  }
  console.log("Configuración cargada:", {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
  });
  assert.ok(process.env.STRIPE_SECRET_KEY, "falta STRIPE_SECRET_KEY");
});
