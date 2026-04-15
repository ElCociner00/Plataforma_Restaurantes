// js/module_fix/supabase_patch.js
// Parchea el cliente de Supabase para usar el token raw
(function() {
  'use strict';

  const TOKEN_RAW_KEY = 'sb-ivgzwgyjyqfunheaesxx-auth-token_raw';

  function getRawToken() {
    const raw = localStorage.getItem(TOKEN_RAW_KEY);
    if (raw && raw.split('.').length === 3) {
      return raw;
    }
    return null;
  }

  // Esperar a que Supabase se inicialice
  const checkInterval = setInterval(() => {
    // Buscar el cliente de Supabase en window
    if (window.supabase || window._supabase) {
      clearInterval(checkInterval);
      
      const supabaseClient = window.supabase || window._supabase;
      
      // Parchear el método de solicitud del cliente
      if (supabaseClient && supabaseClient.rest) {
        const originalRequest = supabaseClient.rest.request;
        
        supabaseClient.rest.request = function(...args) {
          const token = getRawToken();
          if (token && args[0] && args[0].headers) {
            args[0].headers['Authorization'] = `Bearer ${token}`;
          }
          return originalRequest.apply(this, args);
        };
        
        console.log('✅ [Supabase Patch] Cliente Supabase parcheado');
      }
    }
  }, 100);

  // También parchear la sesión directamente en localStorage
  setTimeout(() => {
    const rawToken = getRawToken();
    if (rawToken) {
      // Asegurar que el objeto de sesión tenga el token correcto
      const sessionObj = {
        access_token: rawToken,
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: localStorage.getItem('sb-ivgzwgyjyqfunheaesxx-auth-token_refresh_token')
      };
      
      // Guardar en el formato que session.js espera
      localStorage.setItem('sb-ivgzwgyjyqfunheaesxx-auth-token', JSON.stringify(sessionObj));
      console.log('✅ [Supabase Patch] Sesión reconstruida con token correcto');
    }
  }, 200);
})();
