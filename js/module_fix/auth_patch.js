// js/module_fix/auth_patch.js
// Parche específico para auth.js
(function() {
  'use strict';

  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2Z3p3Z3lqeXFmdW5oZWFlc3h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4NjAxMDUsImV4cCI6MjA4NTQzNjEwNX0.5Q-MQ7fKfCG9Qo09G_vub3-Rn6FHLJ18sf8eKGndhbI';

  // Interceptar la creación del cliente Supabase
  setTimeout(() => {
    if (window.supabase) {
      console.log('🔄 [Auth Patch] Parcheando cliente Supabase existente');
    }
  }, 100);
})();
