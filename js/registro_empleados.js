import { enforceNumericInput } from "./input_utils.js";
import { buildRequestHeaders, getUserContext } from "./session.js";
import { WEBHOOK_REGISTRAR_EMPLEADO } from "./webhooks.js";
import { supabase } from "./supabase.js";

const form = document.getElementById("registroEmpleadoForm");
const btnRegistrar = document.getElementById("btnRegistrar");
const statusDiv = document.getElementById("status");
const cedulaInput = document.getElementById("cedula");
const emailInput = document.getElementById("email");

const usuariosPanel = document.getElementById("usuariosSistemaPanel");
const usuariosEstado = document.getElementById("usuariosSistemaEstado");

const getTimestamp = () => new Date().toISOString();

enforceNumericInput([cedulaInput]);

const setSubmitting = (isSubmitting) => {
  if (!btnRegistrar) return;
  btnRegistrar.disabled = isSubmitting;
  btnRegistrar.textContent = isSubmitting ? "Registrando..." : "Registrar empleado";
};

const setUsuariosEstado = (message) => {
  if (usuariosEstado) usuariosEstado.textContent = message || "";
};

const readResponseBody = async (res) => {
  const raw = await res.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw };
  }
};

const escapeHtml = (value) => String(value || "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

function renderUsuarios(rows) {
  if (!usuariosPanel) return;
  if (!rows.length) {
    usuariosPanel.innerHTML = "<p class='usuarios-vacio'>No hay usuarios para gestionar en esta empresa.</p>";
    return;
  }

  usuariosPanel.innerHTML = `
    <div class="usuarios-tabla-wrap">
      <table class="usuarios-tabla">
        <thead>
          <tr>
            <th>Usuario</th>
            <th>Correo</th>
            <th>Rol</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.nombre_completo || "Sin nombre")}</td>
                <td>${escapeHtml(row.email || "-")}</td>
                <td>${escapeHtml(row.rol || "-")}</td>
              </tr>
            `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function cargarUsuariosGestion() {
  const context = await getUserContext().catch(() => null);
  if (!context?.empresa_id) {
    setUsuariosEstado("No se pudo validar la empresa actual.");
    return;
  }

  setUsuariosEstado("Cargando usuarios...");
  const { data, error } = await supabase
    .from("usuarios_sistema")
    .select("id,nombre_completo,email,rol")
    .eq("empresa_id", context.empresa_id)
    .order("created_at", { ascending: true });

  if (error) {
    setUsuariosEstado(`No se pudieron cargar usuarios: ${error.message || "sin detalle"}`);
    return;
  }

  const rows = (Array.isArray(data) ? data : []).filter((item) => String(item.rol || "").toLowerCase() !== "admin_root");
  renderUsuarios(rows);
  setUsuariosEstado(`Usuarios visibles: ${rows.length}.`);
}



form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const emailValue = emailInput?.value.trim();
  if (!emailValue || !emailInput?.checkValidity()) {
    statusDiv.textContent = "Ingresa un correo válido.";
    emailInput?.focus();
    return;
  }

  const context = await getUserContext();
  if (!context?.empresa_id) {
    statusDiv.textContent = "No se pudo validar la sesión.";
    return;
  }

  const payload = {
    nombre: document.getElementById("nombre")?.value.trim() || "",
    cedula: cedulaInput?.value.trim() || "",
    fecha_ingreso: document.getElementById("fecha_ingreso")?.value || "",
    email: emailValue,
    password: document.getElementById("password")?.value || "",
    empresa_id: context.empresa_id,
    tenant_id: context.empresa_id,
    usuario_id: context.user?.id || context.user?.user_id,
    registrado_por: context.user?.id || context.user?.user_id,
    timestamp: getTimestamp()
  };

  setSubmitting(true);
  statusDiv.textContent = "Registrando empleado...";

  try {
    const authHeaders = await buildRequestHeaders({ includeTenant: true });
    const res = await fetch(WEBHOOK_REGISTRAR_EMPLEADO, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders
      },
      body: JSON.stringify(payload)
    });

    const data = await readResponseBody(res);
    const isSuccess = res.ok && (data?.success === true || data?.ok === true || /registrad/i.test(String(data?.message || "")));

    if (isSuccess) {
      statusDiv.textContent = data?.message || "Empleado registrado correctamente.";
      form.reset();
      await cargarUsuariosGestion();
    } else {
      statusDiv.textContent = data?.message || `Error registrando empleado (HTTP ${res.status}).`;
    }
  } catch {
    statusDiv.textContent = "Error de conexión con backend plataforma.";
  } finally {
    setSubmitting(false);
  }
});

cargarUsuariosGestion();
