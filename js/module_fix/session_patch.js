// js/module_fix/session_patch.js
// Parche completo - Limpia el token y fuerza el formato correcto
(function() {
  'use strict';

  const TOKEN_KEY = 'sb-ivgzwgyjyqfunheaesxx-auth-token';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2Z3p3Z3lqeXFmdW5oZWFlc3h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4NjAxMDUsImV4cCI6MjA4NTQzNjEwNX0.5Q-MQ7fKfCG9Qo09G_vub3-Rn6FHLJ18sf8eKGndhbI';

  // FUNCIÓN CRÍTICA: Reparar el token en localStorage
  function fixTokenInStorage() {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) return null;
    
    try {
      let parsed = JSON.parse(stored);
      // Si es objeto con access_token, extraer solo el token
      if (parsed.access_token && typeof parsed.access_token === 'string') {
        const cleanToken = parsed.access_token;
        const parts = cleanToken.split('.');
        if (parts.length === 3) {
          // Guardar SOLO el token como string puro
          localStorage.setItem(TOKEN_KEY, cleanToken);
          console.log('✅ [Session Patch] Token reparado a string puro (3 partes)');
          return cleanToken;
        }
      }
    } catch(e) {
      // Si no es JSON, ya es string, verificar que tenga 3 partes
      const parts = stored.split('.');
      if (parts.length === 3) {
        console.log('✅ [Session Patch] Token ya es string válido');
        return stored;
      }
    }
    return null;
  }

  // Ejecutar inmediatamente
  const cleanToken = fixTokenInStorage();
  
  function getValidToken() {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) return null;
    
    // Si es string y tiene 3 partes, devolverlo
    if (typeof stored === 'string' && stored.split('.').length === 3) {
      return stored;
    }
    
    // Intentar reparar nuevamente
    try {
      const parsed = JSON.parse(stored);
      if (parsed.access_token) {
        const token = parsed.access_token;
        if (token.split('.').length === 3) {
          localStorage.setItem(TOKEN_KEY, token);
          return token;
        }
      }
    } catch(e) {}
    
    return null;
  }

  const originalFetch = window.fetch;
  
  window.fetch = function(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    
    if (url && url.includes('supabase.co')) {
      const token = getValidToken();
      
      let headers = init.headers || {};
      if (headers instanceof Headers) {
        const plainHeaders = {};
        headers.forEach((value, key) => { plainHeaders[key] = value; });
        headers = plainHeaders;
      }
      
      headers['apikey'] = SUPABASE_ANON_KEY;
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      init.headers = headers;
    }
    
    return originalFetch.call(this, input, init);
  };

  console.log('✅ [Session Patch] Activado - Token reparado:', !!cleanToken);
})();
