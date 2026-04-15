// js/module_fix/session_patch.js
// Parche completo para Supabase (token + API key)
(function() {
  'use strict';

  const TOKEN_KEY = 'sb-ivgzwgyjyqfunheaesxx-auth-token';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2Z3p3Z3lqeXFmdW5oZWFlc3h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4NjAxMDUsImV4cCI6MjA4NTQzNjEwNX0.5Q-MQ7fKfCG9Qo09G_vub3-Rn6FHLJ18sf8eKGndhbI';

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

  const originalFetch = window.fetch;
  
  window.fetch = function(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    
    if (url && url.includes('supabase.co')) {
      const token = getValidToken();
      
      // Normalizar headers
      let headers = init.headers || {};
      if (headers instanceof Headers) {
        const plainHeaders = {};
        headers.forEach((value, key) => { plainHeaders[key] = value; });
        headers = plainHeaders;
      }
      
      // Forzar API key y token en TODAS las llamadas a Supabase
      headers['apikey'] = SUPABASE_ANON_KEY;
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      init.headers = headers;
      
      // Log solo para auth (opcional)
      if (url.includes('/auth/v1/')) {
        console.log('🔑 [Session Patch] Auth call fixed');
      }
    }
    
    return originalFetch.call(this, input, init);
  };

  console.log('✅ [Session Patch] Activado con API key y token');
})();
