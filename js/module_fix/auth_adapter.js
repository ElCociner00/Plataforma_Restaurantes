// js/module_fix/auth_adapter.js
(function() {
  'use strict';

  const TOKEN_STORAGE_KEY = 'sb-ivgzwgyjyqfunheaesxx-auth-token';
  const TOKEN_RAW_KEY = TOKEN_STORAGE_KEY + '_raw';
  const SUPABASE_REST_URL = 'supabase.co/rest/v1/';

  function getAccessToken() {
    // Prioridad 1: Token raw (formato puro de 3 partes)
    const rawToken = localStorage.getItem(TOKEN_RAW_KEY);
    if (rawToken && rawToken.split('.').length === 3) {
      console.log('🔑 Usando token raw');
      return rawToken;
    }
    
    // Prioridad 2: Token desde objeto
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!stored) return null;
    try {
      const parsed = JSON.parse(stored);
      return parsed.access_token || null;
    } catch {
      return stored;
    }
  }

  const originalFetch = window.fetch;

  window.fetch = function(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;

    if (url.includes(SUPABASE_REST_URL)) {
      const token = getAccessToken();
      if (token) {
        init.headers = init.headers || {};
        if (init.headers instanceof Headers) {
          const plainHeaders = {};
          init.headers.forEach((value, key) => { plainHeaders[key] = value; });
          init.headers = plainHeaders;
        }
        init.headers['Authorization'] = `Bearer ${token}`;
      }
    }

    return originalFetch.call(this, input, init);
  };

  console.log('✅ [Module Fix] Adaptador de autenticación (v2) activo.');
})();
