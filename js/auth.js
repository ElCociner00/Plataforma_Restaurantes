import { supabase } from "./supabase.js";
import { getUserContext } from "./session.js";

const form = document.getElementById("loginForm");
const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");

console.log("auth.js cargado correctamente");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  
  console.log("Formulario enviado");
  
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  
  console.log("Email:", email);
  console.log("Password length:", password.length);

  try {
    // 1. Primero verifica que supabase esté funcionando
    console.log("Intentando login con Supabase...");
    
    const { data, error } = await supabase.auth.signInWithPassword({ 
      email, 
      password 
    });
    
    console.log("Respuesta de Supabase:", { data, error });

    if (error) {
      console.error("Error de Supabase:", error.message);
      alert("Credenciales incorrectas: " + error.message);
      return;
    }
    
    console.log("Login exitoso, usuario:", data.user?.email);

    // 2. Obtener contexto
    console.log("Obteniendo contexto de usuario...");
    const context = await getUserContext();
    console.log("Contexto obtenido:", context);

    if (!context) {
      alert("Usuario sin contexto - contacta al administrador");
      return;
    }

    // 3. Redirigir según rol
    console.log("Rol del usuario:", context.rol);
    
    if (context.rol === "operativo") {
      console.log("Redirigiendo a cierre_turno...");
      window.location.href = "/Plataforma_Restaurantes/cierre_turno/";
    } else {
      console.log("Redirigiendo a dashboard...");
      window.location.href = "/Plataforma_Restaurantes/dashboard/";
    }

  } catch (catchError) {
    console.error("Error inesperado en el flujo:", catchError);
    alert("Error interno: " + catchError.message);
  }
});
