import { bootRappiShell, toast } from "./core.js";

try {
  await bootRappiShell();
} catch (error) {
  console.error("[rappi-hub]", error);
  toast(error.message || "No fue posible abrir el centro Rappi.", "error");
}
