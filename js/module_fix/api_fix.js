// js/module_fix/api_fix.js - Versión mejorada
(function() {
    'use strict';
    
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2Z3p3Z3lqeXFmdW5oZWFlc3h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4NjAxMDUsImV4cCI6MjA4NTQzNjEwNX0.5Q-MQ7fKfCG9Qo09G_vub3-Rn6FHLJ18sf8eKGndhbI';
    
    function getToken() {
        const stored = localStorage.getItem('sb-ivgzwgyjyqfunheaesxx-auth-token');
        if (!stored) return null;
        
        // Si es string puro y tiene 3 partes, devolverlo
        if (typeof stored === 'string' && stored.split('.').length === 3) {
            return stored;
        }
        
        // Si es objeto, extraer access_token
        try {
            const parsed = JSON.parse(stored);
            return parsed.access_token || null;
        } catch(e) {
            return null;
        }
    }
    
    const originalFetch = window.fetch;
    
    window.fetch = function(input, init = {}) {
        const url = typeof input === 'string' ? input : input.url;
        
        // Interceptar TODAS las llamadas a la API REST
        if (url && url.includes('supabase.co/rest/v1/')) {
            const token = getToken();
            
            let headers = init.headers || {};
            if (headers instanceof Headers) {
                const plain = {};
                headers.forEach((v, k) => plain[k] = v);
                headers = plain;
            }
            
            // Forzar headers
            headers['apikey'] = SUPABASE_ANON_KEY;
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            init.headers = headers;
        }
        
        return originalFetch.call(this, input, init);
    };
    
    console.log('✅ [API Fix] Activado para TODAS las tablas');
})();
