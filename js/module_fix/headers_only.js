// js/module_fix/headers_only.js
// Solo añade headers sin modificar el token
(function() {
  'use strict';

  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2Z3p3Z3lqeXFmdW5oZWFlc3h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4NjAxMDUsImV4cCI6MjA4NTQzNjEwNX0.5Q-MQ7fKfCG9Qo09G_vub3-Rn6FHLJ18sf8eKGndhbI';

  const originalFetch = window.fetch;
  
  window.fetch = function(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    
    if (url && url.includes('supabase.co')) {
      // Crear headers si no existen
      let headers = init.headers || {};
      
      // Convertir Headers object a plain object si es necesario
      if (headers instanceof Headers) {
        const plainHeaders = {};
        headers.forEach((value, key) => { plainHeaders[key] = value; });
        headers = plainHeaders;
      }
      
      // Asegurar que la API key está presente (NO tocar Authorization)
      if (!headers['apikey'] && !headers['apiKey']) {
        headers['apikey'] = SUPABASE_ANON_KEY;
      }
      
      init.headers = headers;
    }
    
    return originalFetch.call(this, input, init);
  };

  console.log('✅ [Headers Only] Activado - Solo añade API key');
})();
