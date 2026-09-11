import { bootRappiShell, toast } from "./core.js?v=20260911rappi3";

try {
  await bootRappiShell();
} catch (error) {
  console.error("[rappi-hub]", error);
  toast(error.message || "No fue posible abrir el centro Rappi.", "error");
}
