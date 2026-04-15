// js/module_fix/session_patch.js
// Parchea el cliente de Supabase para que use el token correcto
(function() {
  'use strict';

  const TOKEN_KEY = 'sb-ivgzwgyjyqfunheaesxx-auth-token';

  function getValidToken() {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) return null;
    try {
      const parsed = JSON.parse(stored);
      return parsed.access_token || null;
    } catch {
      return stored;
    }
  }

  // Esperar a que se inicialice Supabase
  const originalFetch = window.fetch;
  
  // Interceptar TODAS las llamadas a Supabase (incluyendo las del cliente interno)
  window.fetch = function(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    
    // Si es una llamada a Supabase
    if (url && url.includes('supabase.co')) {
      const token = getValidToken();
      if (token) {
        init.headers = init.headers || {};
        if (init.headers instanceof Headers) {
          const plainHeaders = {};
          init.headers.forEach((value, key) => { plainHeaders[key] = value; });
          init.headers = plainHeaders;
        }
        // Forzar el token en cada llamada
        init.headers['Authorization'] = `Bearer ${token}`;
        init.headers['apikey'] = 'ivgzwgyjyqfunheaesxx'; // La anon key
      }
    }
    
    return originalFetch.call(this, input, init);
  };

  // También interceptar el cliente de Supabase si ya existe
  setTimeout(() => {
    if (window.supabaseClient) {
      const originalRequest = window.supabaseClient.request;
      if (originalRequest) {
        window.supabaseClient.request = function(...args) {
          const token = getValidToken();
          if (token && args[0]) {
            args[0].headers = args[0].headers || {};
            args[0].headers['Authorization'] = `Bearer ${token}`;
          }
          return originalRequest.apply(this, args);
        };
      }
    }
  }, 100);

  console.log('✅ [Session Patch] Parche de sesión activo');
})();
