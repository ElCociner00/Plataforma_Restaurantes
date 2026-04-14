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

    try {
      const parsedUrl = new URL(url, window.location.origin);
      const entries = Array.from(parsedUrl.searchParams.entries());
      let changed = false;

      parsedUrl.search = "";
      entries.forEach(([key, value]) => {
        const normalizedValue = String(value || "").trim().toLowerCase();

        if (normalizedValue === "activo") {
          parsedUrl.searchParams.append(key, "true");
          changed = true;
          return;
        }

        if (normalizedValue === "inactivo") {
          parsedUrl.searchParams.append(key, "false");
          changed = true;
          return;
        }

        if (normalizedValue === "eq.activo") {
          parsedUrl.searchParams.append(key, "eq.true");
          changed = true;
          return;
        }

        if (normalizedValue === "eq.inactivo") {
          parsedUrl.searchParams.append(key, "eq.false");
          changed = true;
          return;
        }

        if (normalizedValue === "is.activo") {
          parsedUrl.searchParams.append(key, "is.true");
          changed = true;
          return;
        }

        if (normalizedValue === "is.inactivo") {
          parsedUrl.searchParams.append(key, "is.false");
          changed = true;
          return;
        }

        parsedUrl.searchParams.append(key, value);
      });

      if (!changed) return url;
      return parsedUrl.toString();
    } catch {
      // Fallback regex para URLs no parseables.
      return url
        .replace(/([?&])([^&=]+)=activo(?=&|$)/gi, "$1$2=true")
        .replace(/([?&])([^&=]+)=inactivo(?=&|$)/gi, "$1$2=false")
        .replace(/([?&])([^&=]+)=eq\.activo(?=&|$)/gi, "$1$2=eq.true")
        .replace(/([?&])([^&=]+)=eq\.inactivo(?=&|$)/gi, "$1$2=eq.false")
        .replace(/([?&])([^&=]+)=is\.activo(?=&|$)/gi, "$1$2=is.true")
        .replace(/([?&])([^&=]+)=is\.inactivo(?=&|$)/gi, "$1$2=is.false");
    }
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
