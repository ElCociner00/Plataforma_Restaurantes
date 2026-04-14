// Parche aislado para inyectar token JWT en peticiones a Supabase REST.
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

  const originalFetch = window.fetch.bind(window);

  window.fetch = function patchedFetch(input, init = {}) {
    const url = typeof input === "string" ? input : input?.url;
    if (!url || !url.includes(SUPABASE_REST_PATH)) {
      return originalFetch(input, init);
    }

    const token = getAccessToken();
    if (!token) {
      return originalFetch(input, init);
    }

    const headers = new Headers(init.headers || {});
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    return originalFetch(input, {
      ...init,
      headers
    });
  };

  console.log("✅ [Module Fix] Adaptador de autenticación activo para Supabase REST.");
})();
