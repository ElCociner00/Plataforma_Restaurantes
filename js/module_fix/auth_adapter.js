// js/module_fix/auth_adapter.js - Versión funcional
(function() {
  'use strict';

  function getAccessToken() {
    const stored = localStorage.getItem('sb-ivgzwgyjyqfunheaesxx-auth-token');
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

    if (url && url.includes('supabase.co')) {
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

  console.log('✅ [Auth Adapter] Activado');
})();
