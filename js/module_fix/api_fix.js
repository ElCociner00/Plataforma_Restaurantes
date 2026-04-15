// js/module_fix/api_fix.js
// SOLO para peticiones API - No interfiere con login/sesión
(function() {
    'use strict';
    
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2Z3p3Z3lqeXFmdW5oZWFlc3h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4NjAxMDUsImV4cCI6MjA4NTQzNjEwNX0.5Q-MQ7fKfCG9Qo09G_vub3-Rn6FHLJ18sf8eKGndhbI';
    
    // Función segura para obtener token
    function getToken() {
        const stored = localStorage.getItem('sb-ivgzwgyjyqfunheaesxx-auth-token');
        if (!stored) return null;
        try {
            const parsed = JSON.parse(stored);
            return parsed.access_token || null;
        } catch(e) {
            return stored;
        }
    }
    
    // Guardar referencia original
    const originalFetch = window.fetch;
    
    // Interceptar SOLO peticiones a las tablas específicas
    window.fetch = function(input, init = {}) {
        const url = typeof input === 'string' ? input : input.url;
        
        // SOLO aplicar a las tablas problemáticas
        const shouldIntercept = url && (
            url.includes('/rest/v1/empresas') ||
            url.includes('/rest/v1/billing_cycles') ||
            url.includes('/rest/v1/rpc/get_my_context')
        );
        
        if (shouldIntercept) {
            const token = getToken();
            
            // Normalizar headers
            let headers = init.headers || {};
            if (headers instanceof Headers) {
                const plain = {};
                headers.forEach((v, k) => plain[k] = v);
                headers = plain;
            }
            
            // Añadir headers necesarios
            headers['apikey'] = SUPABASE_ANON_KEY;
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            init.headers = headers;
        }
        
        return originalFetch.call(this, input, init);
    };
    
    console.log('✅ [API Fix] Activado para empresas y billing_cycles');
})();
