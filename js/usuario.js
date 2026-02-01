const status = document.getElementById("status");
const form = document.getElementById("registroUsuario");

// 🔍 Recuperamos el NIT de la sesión
const empresaNIT = sessionStorage.getItem("empresa_nit");

if (!empresaNIT) {
  status.innerText = "Error: no se encontró información de la empresa.";
  form.style.display = "none";
  throw new Error("NIT no encontrado en sessionStorage");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const usernameInput = document.getElementById("username").value.trim();

  if (!usernameInput) {
    status.innerText = "El username es obligatorio";
    return;
  }

  // 🔐 Construimos el email real (sin cambiar el nombre del campo)
  const emailFinal = `${usernameInput}@globalnexo.com`;

  const payload = {
    nombre_visible: nombre_visible.value,
    email: emailFinal,       // ⬅️ MISMO CAMPO, MEJOR UX
    password: password.value,
    nit: empresaNIT
  };

  status.innerText = "Creando usuario...";

  try {
    const res = await fetch(
      "https://n8n.globalnexoshop.com/webhook/registro_usuario",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    const data = await res.json();

    if (!data.ok) {
      status.innerText = data.error || "Error creando el usuario";
      return;
    }

    // 🧹 Limpieza de sesión
    sessionStorage.removeItem("empresa_nit");

    alert("Registro exitoso. Ahora puedes iniciar sesión.");
    window.location.href = "/Plataforma_Restaurantes/login/";

  } catch (err) {
    status.innerText = "Error inesperado. Intenta nuevamente.";
  }
});
