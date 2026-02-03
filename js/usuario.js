const status = document.getElementById("status");
const form = document.getElementById("registroUsuario");
const nombreVisibleInput = document.getElementById("nombre_visible");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const correoSugerido = document.getElementById("correoSugerido");

// 🔍 Recuperamos el NIT de la sesión
const empresaNIT = sessionStorage.getItem("empresa_nit");
const empresaCorreo = sessionStorage.getItem("empresa_correo");

if (!empresaNIT) {
  status.innerText = "Error: no se encontró información de la empresa.";
  form.style.display = "none";
  throw new Error("NIT no encontrado en sessionStorage");
}

if (empresaCorreo && correoSugerido) {
  correoSugerido.textContent = `Sugerido: ${empresaCorreo}`;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const emailValue = emailInput.value.trim();

  if (!emailValue || !emailInput.checkValidity()) {
    status.innerText = "Ingresa un correo válido";
    return;
  }

  const payload = {
    nombre_visible: nombreVisibleInput.value.trim(),
    email: emailValue,
    password: passwordInput.value,
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
    window.location.href = "/Plataforma_Restaurantes/index.html";

  } catch (err) {
    status.innerText = "Error inesperado. Intenta nuevamente.";
  }
});
