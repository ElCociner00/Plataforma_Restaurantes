// js/module_fix/auth_adapter.js
// Parche aislado: Inyecta token JWT + Corrige parámetros booleanos (v3 - Robusta).
// NO MODIFICA NINGÚN ARCHIVO EXISTENTE.

(function() {
  'use strict';

  const TOKEN_STORAGE_KEY = 'sb-ivgzwgyjyqfunheaesxx-auth-token';
  const SUPABASE_REST_URL = 'supabase.co/rest/v1/';

  function getAccessToken() {
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!stored) return null;
    try {
      const parsed = JSON.parse(stored);
      return parsed.access_token || parsed.token || parsed.accessToken || null;
    } catch {
      return null;
    }
  }

  const originalFetch = window.fetch;

  window.fetch = function(input, init = {}) {
    let url = typeof input === 'string' ? input : input.url;

    if (url.includes(SUPABASE_REST_URL)) {
      // 1. Inyectar token JWT
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

      // 2. CORRECCIÓN ROBUSTA: Reemplazar valores 'activo' e 'inactivo' en TODA la URL
      //    sin importar cómo esté formateada (codificada o no).
      try {
        // Decodificamos la URL para trabajar con texto plano
        let decodedUrl = decodeURIComponent(url);
        
        // Reemplazamos CUALQUIER ocurrencia de '=activo' por '=true'
        // y '=inactivo' por '=false', siempre que esté precedido por '=' y seguido por '&' o fin de string.
        decodedUrl = decodedUrl.replace(/=(activo)(?=&|$)/g, '=true');
        decodedUrl = decodedUrl.replace(/=(inactivo)(?=&|$)/g, '=false');
        
        // También manejamos el caso donde 'activo' está como valor de un parámetro booleano
        // (esto ya lo cubre la expresión anterior, pero por si acaso)
        
        // Reconstruimos la URL (no es necesario volver a codificar, fetch lo maneja)
        url = decodedUrl;
      } catch (e) {
        // Si falla la decodificación, usamos la URL original sin modificar
        console.warn('[Module Fix] No se pudo decodificar la URL para corregir booleanos:', e);
      }

      // Si el input era un objeto Request, crear uno nuevo con la URL corregida
      if (typeof input === 'object' && input instanceof Request) {
        input = new Request(url, input);
      } else {
        input = url;
      }
    }

    return originalFetch.call(this, input, init);
  };

  console.log('✅ [Module Fix] Adaptador de autenticación + corrección robusta de booleanos activo.');
})();
