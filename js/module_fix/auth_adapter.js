// Parche aislado para inyectar token JWT y corregir parámetros booleanos mal formados.
// No modifica la lógica de módulos existentes.
(function () {
  "use strict";

  const TOKEN_STORAGE_KEY = "sb-ivgzwgyjyqfunheaesxx-auth-token";
  const SUPABASE_REST_PATH = ".supabase.co/rest/v1/";

  function parseStoredSession(raw) {
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;

      if (parsed.access_token) return parsed;
      if (parsed.currentSession?.access_token) return parsed.currentSession;
      if (parsed.session?.access_token) return parsed.session;
      return null;
    } catch {
      return null;
    }
  }

  function getAccessToken() {
    const session = parseStoredSession(localStorage.getItem(TOKEN_STORAGE_KEY));
    return session?.access_token || null;
  }

  function normalizeBooleanParams(url) {
    if (!url) return url;

    // Casos reportados (valor literal) y variantes comunes usadas por PostgREST.
    return url
      .replace(/([&?])(activo|activa)=activo([&]|$)/gi, "$1$2=true$3")
      .replace(/([&?])(activo|activa)=inactivo([&]|$)/gi, "$1$2=false$3")
      .replace(/([&?])(activo|activa)=eq\.activo([&]|$)/gi, "$1$2=eq.true$3")
      .replace(/([&?])(activo|activa)=eq\.inactivo([&]|$)/gi, "$1$2=eq.false$3")
      .replace(/([&?])(activo|activa)=is\.activo([&]|$)/gi, "$1$2=is.true$3")
      .replace(/([&?])(activo|activa)=is\.inactivo([&]|$)/gi, "$1$2=is.false$3");
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = function patchedFetch(input, init = {}) {
    const originalUrl = typeof input === "string" ? input : input?.url;
    const url = normalizeBooleanParams(originalUrl);
    if (!url || !url.includes(SUPABASE_REST_PATH)) {
      return originalFetch(input, init);
    }

    const nextInput = (typeof input === "object" && input instanceof Request)
      ? new Request(url, input)
      : url;

    const token = getAccessToken();
    if (!token) {
      return originalFetch(nextInput, init);
    }

    const headers = new Headers(init.headers || {});
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    return originalFetch(nextInput, {
      ...init,
      headers
    });
  };

  console.log("✅ [Module Fix] Adaptador de autenticación + corrección de booleanos activo.");
})();
