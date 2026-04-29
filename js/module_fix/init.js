/**
 * Parche aislado de inicialización de módulos.
 * Objetivo: evitar 404 en páginas que esperan este script y no romper flujo.
 * Este archivo no altera lógica de negocio; solo garantiza un arranque seguro.
 */

const safeRun = () => {
  try {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    // Marca de diagnóstico útil para soporte (no visible al cliente).
    window.__moduleFixInitLoaded = true;
  } catch (_error) {
    // no-op intencional para aislar errores
  }
};

safeRun();
