// js/module_fix/auth_adapter.js
// Versión MÍNIMA: SOLO inyecta el token JWT. No toca la URL.
(function() {
  'use strict';

  const TOKEN_STORAGE_KEY = 'sb-ivgzwgyjyqfunheaesxx-auth-token';
  const SUPABASE_REST_URL = 'supabase.co/rest/v1/';

  function getAccessToken() {
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!stored) return null;
    try {
      const parsed = JSON.parse(stored);
      // Devolver SOLO el string del token
      return parsed.access_token || null;
    } catch {
      return null;
    }
  }

  const originalFetch = window.fetch;

  window.fetch = function(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;

    // SOLO inyectar token si es una llamada a la API REST de Supabase
    if (url.includes(SUPABASE_REST_URL)) {
      const token = getAccessToken();
      if (token) {
        init.headers = init.headers || {};
        if (init.headers instanceof Headers) {
          const plainHeaders = {};
          init.headers.forEach((value, key) => { plainHeaders[key] = value; });
          init.headers = plainHeaders;
        }
        // Asegurar que el header Authorization tenga el formato correcto
        init.headers['Authorization'] = `Bearer ${token}`;
      }
    }

    return originalFetch.call(this, input, init);
  };

  console.log('✅ [Module Fix] Adaptador de autenticación (token JWT) activo.');
})();
