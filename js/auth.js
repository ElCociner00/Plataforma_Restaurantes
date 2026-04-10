import { supabase } from "./supabase.js";
import { getUserContext } from "./session.js";

const form = document.getElementById("loginForm");
const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");

console.log("auth.js cargado correctamente");

const emergencyLookupByEmail = async (email) => {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;

  const { data: fromSistema } = await supabase
    .from("usuarios_sistema")
    .select("id, empresa_id, rol, activo, nombre_completo")
    .eq("nombre_completo", normalized)
    .eq("activo", true)
    .limit(1)
    .maybeSingle();

  if (fromSistema?.id && fromSistema?.empresa_id) {
    return {
      user_id: fromSistema.id,
      empresa_id: fromSistema.empresa_id,
      rol: fromSistema.rol || "admin",
      email: normalized
    };
  }

  const { data: fromOtros } = await supabase
    .from("otros_usuarios")
    .select("id, empresa_id, estado, nombre_completo")
    .eq("nombre_completo", normalized)
    .eq("estado", true)
    .limit(1)
    .maybeSingle();

  if (fromOtros?.id && fromOtros?.empresa_id) {
    return {
      user_id: fromOtros.id,
      empresa_id: fromOtros.empresa_id,
      rol: "revisor",
      email: normalized
    };
  }

  return null;
};

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  
  console.log("Formulario enviado");
  
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  
  console.log("Email:", email);
  console.log("Password length:", password.length);

  try {
    // 1. Intento de autenticación
    console.log("Intentando login...");
    
    const { data, error } = await supabase.auth.signInWithPassword({ 
      email, 
      password 
    });
    
    console.log("Respuesta de autenticación:", { data, error });

    if (error) {
      console.error("Error de autenticación:", error.message);
      let emergency = null;
      if (typeof window.setEmergencyLocalSession === "function") {
        emergency = await emergencyLookupByEmail(email);
      }
      if (emergency) {
        const ok = window.setEmergencyLocalSession(emergency);
        if (ok) {
          alert("Ingreso en modo de contingencia activado.");
          window.location.href = "/Plataforma_Restaurantes/entorno/";
          return;
        }
      }
      alert("Credenciales incorrectas: " + error.message);
      return;
    }
    
    console.log("Login exitoso, usuario:", data.user?.email);

    // 2. Obtener contexto
    console.log("Obteniendo contexto de usuario...");
    const context = await getUserContext();
    console.log("Contexto obtenido:", context);

    if (!context) {
      let recovered = null;
      if (typeof window.bootstrapContextByIdentity === "function") {
        recovered = await window.bootstrapContextByIdentity({ email });
      }

      if (!recovered) {
        const cedula = window.prompt("No se encontró contexto automático. Ingresa tu cédula para validar acceso:");
        if (cedula && typeof window.bootstrapContextByIdentity === "function") {
          recovered = await window.bootstrapContextByIdentity({ email, cedula });
        }
      }

      if (recovered?.empresa_id) {
        alert("Acceso recuperado correctamente.");
        window.location.href = "/Plataforma_Restaurantes/entorno/";
        return;
      }

      alert("No se pudo validar tu contexto. Contacta al administrador.");
      return;
    }

    // 3. Redirigir al selector de entorno
    console.log("Rol del usuario:", context.rol);
    if (context.super_admin === true && !context.empresa_id) {
      window.location.href = "/Plataforma_Restaurantes/gestion_empresas/";
      return;
    }

    window.location.href = "/Plataforma_Restaurantes/entorno/";

  } catch (catchError) {
    console.error("Error inesperado en el flujo:", catchError);
    alert("Error interno: " + catchError.message);
  }
});
