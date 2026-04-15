// js/module_fix/after_login.js
// Este script se ejecuta SOLO cuando hay un usuario logueado
(function() {
  'use strict';

  const TOKEN_KEY = 'sb-ivgzwgyjyqfunheaesxx-auth-token';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2Z3p3Z3lqeXFmdW5oZWFlc3h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4NjAxMDUsImV4cCI6MjA4NTQzNjEwNX0.5Q-MQ7fKfCG9Qo09G_vub3-Rn6FHLJ18sf8eKGndhbI';

  // Verificar si hay sesión activa
  function isLoggedIn() {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) return false;
    try {
      const parsed = JSON.parse(stored);
      return !!parsed.access_token;
    } catch {
      return false;
    }
  }

  // Solo activar si hay sesión
  if (!isLoggedIn()) {
    console.log('⚠️ [After Login] No hay sesión activa, esperando...');
    // Escuchar cambios en localStorage
    window.addEventListener('storage', function(e) {
      if (e.key === TOKEN_KEY && e.newValue) {
        location.reload();
      }
    });
    return;
  }

  // Limpiar el token a string puro
  const stored = localStorage.getItem(TOKEN_KEY);
  try {
    const parsed = JSON.parse(stored);
    if (parsed.access_token) {
      localStorage.setItem(TOKEN_KEY, parsed.access_token);
      console.log('✅ [After Login] Token limpiado a string puro');
    }
  } catch(e) {}

  // Interceptar fetch SOLO para peticiones API
  const originalFetch = window.fetch;
  window.fetch = function(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    
    if (url && url.includes('supabase.co/rest/v1/')) {
      const token = localStorage.getItem(TOKEN_KEY);
      if (token && token.split('.').length === 3) {
        init.headers = init.headers || {};
        if (init.headers instanceof Headers) {
          const plainHeaders = {};
          init.headers.forEach((value, key) => { plainHeaders[key] = value; });
          init.headers = plainHeaders;
        }
        init.headers['apikey'] = SUPABASE_ANON_KEY;
        init.headers['Authorization'] = `Bearer ${token}`;
      }
    }
    
    return originalFetch.call(this, input, init);
  };

  console.log('✅ [After Login] Activado - Sesión estable');
})();
