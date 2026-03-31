import { getUserContext } from "./session.js";
import { WEBHOOK_SIIGO_PROVEEDORES_LISTAR, WEBHOOK_SIIGO_PROVEEDORES_REGISTRAR } from "./webhooks.js";
import { enforceNumericInput } from "./input_utils.js";

const proveedoresBody = document.getElementById("proveedoresBody");
const recargarProveedores = document.getElementById("recargarProveedores");
const registrarProveedor = document.getElementById("registrarProveedor");
const razonSocial = document.getElementById("razonSocial");
const nitProveedor = document.getElementById("nitProveedor");
const codigoEspecial = document.getElementById("codigoEspecial");
const codigoContable = document.getElementById("codigoContable");
const tipoProveedor = document.getElementById("tipoProveedor");
const status = document.getElementById("status");

const setStatus = (message) => {
  status.textContent = message;
};

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const getTimestamp = () => new Date().toISOString();

const parseResponse = async (res) => {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

const normalizeList = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.proveedores)) return payload.proveedores;
  return [];
};

const buildContextPayload = async () => {
  const context = await getUserContext();
  if (!context) return null;

  return {
    tenant_id: context.empresa_id,
    empresa_id: context.empresa_id,
    usuario_id: context.user?.id || context.user?.user_id,
    rol: context.rol,
    timestamp: getTimestamp()
  };
};

const mapProveedorRow = (item = {}) => ({
  nit: item["NIT Proveedor"] ?? item.nit ?? "",
  tipo: item.Tipo ?? item.tipo ?? "",
  proveedor: item.Proveedor ?? item.proveedor ?? "",
  codigo_contable: item["Codigo Contable"] ?? item.codigo_contable ?? "",
  nombre: item.Nombre ?? item.nombre ?? ""
});

const renderRows = (rows) => {
  proveedoresBody.innerHTML = "";
  if (!rows.length) {
    proveedoresBody.innerHTML = '<tr><td colspan="5">No hay proveedores para mostrar.</td></tr>';
    return;
  }

  proveedoresBody.innerHTML = rows.map((row) => `
    <tr>
      <td class="col-nit">${escapeHtml(row.nit || "-")}</td>
      <td class="col-tipo">${escapeHtml(row.tipo || "-")}</td>
      <td class="col-proveedor">${escapeHtml(row.proveedor || "-")}</td>
      <td class="col-codigo">${escapeHtml(row.codigo_contable || "-")}</td>
      <td class="col-nombre">${escapeHtml(row.nombre || "-")}</td>
    </tr>
  `).join("");
};

const cargarProveedores = async ({ silent = false } = {}) => {
  const context = await buildContextPayload();
  if (!context) {
    setStatus("No se pudo validar sesión.");
    return;
  }

  if (!silent) setStatus("Consultando proveedores...");

  try {
    const res = await fetch(WEBHOOK_SIIGO_PROVEEDORES_LISTAR, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...context,
        accion: "listar_proveedores_siigo"
      })
    });

    const data = await parseResponse(res);
    if (!res.ok || data?.ok === false) {
      setStatus(data?.message || `Error consultando proveedores (HTTP ${res.status}).`);
      return;
    }

    const rows = normalizeList(data).map(mapProveedorRow);
    renderRows(rows);
    if (!silent) setStatus(`Proveedores cargados: ${rows.length}.`);
  } catch (error) {
    setStatus(`Error consultando proveedores: ${error?.message || "sin detalle"}.`);
  }
};

const applyDefaultsByCodigoEspecial = () => {
  const especial = String(codigoEspecial.value || "NO").toUpperCase();
  if (especial === "NO") {
    codigoContable.value = "14350501";
    tipoProveedor.value = "INVENTARIOS";
  }
};

const validarFormulario = () => {
  const codigo = String(codigoContable.value || "").trim();
  const nit = String(nitProveedor.value || "").trim();
  const razon = String(razonSocial.value || "").trim();
  const tipo = String(tipoProveedor.value || "").trim().toUpperCase();

  tipoProveedor.value = tipo;

  if (!razon || !nit || !tipo || !codigo) {
    setStatus("Completa todos los campos del formulario.");
    return false;
  }

  if (!/^\d{8}$/.test(codigo)) {
    setStatus("Recuerde que el código contable debe tener 8 dígitos.");
    return false;
  }

  return true;
};

const registrarNuevoProveedor = async () => {
  if (!validarFormulario()) return;

  const context = await buildContextPayload();
  if (!context) {
    setStatus("No se pudo validar sesión.");
    return;
  }

  const payload = {
    ...context,
    accion: "registrar_proveedor_siigo",
    proveedor: {
      razon_social: String(razonSocial.value || "").trim(),
      nit_proveedor: String(nitProveedor.value || "").trim(),
      codigo_especial: String(codigoEspecial.value || "NO").toUpperCase(),
      codigo_contable: String(codigoContable.value || "").trim(),
      tipo: String(tipoProveedor.value || "").trim().toUpperCase()
    }
  };

  registrarProveedor.disabled = true;
  setStatus("Registrando proveedor...");

  try {
    const res = await fetch(WEBHOOK_SIIGO_PROVEEDORES_REGISTRAR, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await parseResponse(res);
    if (!res.ok || data?.ok === false) {
      setStatus(data?.message || `No se pudo registrar (HTTP ${res.status}).`);
      return;
    }

    const successLabel = typeof data === "boolean"
      ? String(data)
      : (typeof data?.ok === "boolean" ? String(data.ok) : "true");
    setStatus(data?.message || `Nuevo proveedor registrado (${successLabel}).`);
    await cargarProveedores({ silent: true });
  } catch (error) {
    setStatus(`Error registrando proveedor: ${error?.message || "sin detalle"}.`);
  } finally {
    registrarProveedor.disabled = false;
  }
};

enforceNumericInput([nitProveedor, codigoContable]);
recargarProveedores?.addEventListener("click", () => cargarProveedores());
registrarProveedor?.addEventListener("click", registrarNuevoProveedor);
codigoEspecial?.addEventListener("change", applyDefaultsByCodigoEspecial);
tipoProveedor?.addEventListener("input", () => {
  tipoProveedor.value = String(tipoProveedor.value || "").toUpperCase();
});

applyDefaultsByCodigoEspecial();
cargarProveedores();
