import { enforceNumericInput } from "../js/input_utils.js";
import { getUserContext } from "../js/session.js";
import { supabase } from "../js/supabase.js";
import { getEmpresaPolicy, puedeEnviarDatos } from "../js/permisos.core.js";
import {
  WEBHOOK_CIERRE_INVENTARIOS_CARGAR_PRODUCTOS,
  WEBHOOK_CIERRE_INVENTARIOS_CONSULTAR,
  WEBHOOK_CIERRE_INVENTARIOS_SUBIR,
  WEBHOOK_LISTAR_RESPONSABLES
} from "../js/webhooks.js";

const fecha = document.getElementById("fecha");
const responsable = document.getElementById("responsable");
const horaInicio = document.getElementById("hora_inicio");
const horaFin = document.getElementById("hora_fin");
const inventarioBody = document.getElementById("inventarioBody");
const status = document.getElementById("status");
const loadingOverlay = document.getElementById("loadingOverlay");

const btnConsultar = document.getElementById("consultar");
const btnVerificar = document.getElementById("verificar");
const btnSubir = document.getElementById("subir");
const btnLimpiar = document.getElementById("limpiar");
const btnDescargarImagen = document.getElementById("descargarImagenInventario");

let loadingSafetyTimeoutId = null;
let nombreEmpresaActual = "";

const setStatus = (message) => {
  status.textContent = message;
};


const setLoading = (isLoading, message = "") => {
  if (loadingSafetyTimeoutId) {
    clearTimeout(loadingSafetyTimeoutId);
    loadingSafetyTimeoutId = null;
  }

  if (loadingOverlay) {
    loadingOverlay.classList.toggle("is-hidden", !isLoading);

    if (isLoading) {
      loadingSafetyTimeoutId = setTimeout(() => {
        loadingOverlay.classList.add("is-hidden");
        setStatus("Carga finalizada por límite de 5 segundos.");
        loadingSafetyTimeoutId = null;
      }, MAX_LOADING_MS);
    }
  }

  if (message) setStatus(message);
};

const MAX_LOADING_MS = 5000;
const getTimestamp = () => new Date().toISOString();

const readResponseBody = async (res) => {
  const raw = await res.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw };
  }
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = MAX_LOADING_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

const getContextPayload = async () => {
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

const cargarPoliticaEmpresa = async () => {
  const context = await getUserContext();
  if (!context?.empresa_id) return;
  empresaPolicy = await getEmpresaPolicy(context.empresa_id).catch((error) => { setStatus("Error del sistema validando el plan. Recarga la pagina."); console.error("Error cargando politica de plan:", error); return { ...empresaPolicy, plan: "free", solo_lectura: true }; });
  aplicarPoliticaSoloLectura();
};



const cargarNombreEmpresa = async () => {
  try {
    const contextPayload = await getContextPayload();
    const empresaId = contextPayload?.empresa_id || contextPayload?.tenant_id;
    if (!empresaId) return;

    const { data, error } = await supabase
      .from("empresas")
      .select("nombre_comercial")
      .eq("id", empresaId)
      .maybeSingle();

    if (error) return;
    nombreEmpresaActual = String(data?.nombre_comercial || "").trim();
  } catch (_error) {
    nombreEmpresaActual = "";
  }
};

const normalizeList = (raw, keys = []) => {
  const parsePossiblyWrappedJson = (value) => {
    if (typeof value !== "string") return value;

    const trimmed = value.trim();
    if (!trimmed) return value;

    const objectPrefix = "[Object:";
    if (trimmed.startsWith(objectPrefix) && trimmed.endsWith("]")) {
      const objectContent = trimmed.slice(objectPrefix.length, -1).trim();
      try {
        return JSON.parse(objectContent);
      } catch (error) {
        return value;
      }
    }

    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        return value;
      }
    }

    return value;
  };

  const parsedRaw = parsePossiblyWrappedJson(raw);

  if (Array.isArray(parsedRaw) && parsedRaw.length === 1) {
    const single = parsePossiblyWrappedJson(parsedRaw[0]);
    if (single && typeof single === "object") {
      return normalizeList(single, keys);
    }
  }

  raw = parsedRaw;

  if (!raw) return [];

  const extractFromObjectValues = (obj) => {
    if (!obj || typeof obj !== "object") return [];

    return Object.values(obj).flatMap((value) => {
      const parsedValue = parsePossiblyWrappedJson(value);
      if (Array.isArray(parsedValue)) {
        return parsedValue
          .map((item) => parsePossiblyWrappedJson(item))
          .filter((item) => item && typeof item === "object");
      }

      if (parsedValue && typeof parsedValue === "object") {
        for (const key of keys) {
          if (Array.isArray(parsedValue[key])) return parsedValue[key];
        }
      }

      return [];
    });
  };

  if (Array.isArray(raw)) {
    if (!raw.length) return [];

    for (const key of keys) {
      const nested = raw.flatMap((item) => {
        const parsedItem = parsePossiblyWrappedJson(item);
        if (!parsedItem || typeof parsedItem !== "object") return [];
        if (Array.isArray(parsedItem[key])) return parsedItem[key];
        if (parsedItem[key] && typeof parsedItem[key] === "object") {
          return Object.entries(parsedItem[key]).map(([id, value]) => ({
            id,
            ...(typeof value === "object" ? value : { value })
          }));
        }
        return [];
      });
      if (nested.length) return nested;
    }

    return raw
      .map((item) => parsePossiblyWrappedJson(item))
      .filter((item) => item && typeof item === "object");
  }

  if (typeof raw !== "object") return [];

  for (const key of keys) {
    if (Array.isArray(raw[key])) return raw[key];
    if (raw[key] && typeof raw[key] === "object") {
      return Object.entries(raw[key]).map(([id, item]) => ({
        id,
        ...(typeof item === "object" ? item : { value: item })
      }));
    }

    const parsedCandidate = parsePossiblyWrappedJson(raw[key]);
    if (Array.isArray(parsedCandidate)) {
      return parsedCandidate
        .map((item) => parsePossiblyWrappedJson(item))
        .filter((item) => item && typeof item === "object");
    }
  }

  const nestedFromValues = extractFromObjectValues(raw);
  if (nestedFromValues.length) return nestedFromValues;

  return Object.entries(raw)
    .filter(([id]) => id !== "ok" && id !== "message")
    .map(([id, item]) => ({
      id,
      ...(typeof item === "object" ? item : { value: item })
    }));
};

const normalizeIdentifier = (value) => String(value ?? "").trim();

const normalizeProductId = (value) => {
  const raw = normalizeIdentifier(value);
  if (!raw) return "";

  const objectIdMatch = raw.match(/^ObjectId\((?:"|')?([a-fA-F0-9]{24})(?:"|')?\)$/);
  if (objectIdMatch) return objectIdMatch[1].toLowerCase();

  const plainHexMatch = raw.match(/^[a-fA-F0-9]{24}$/);
  if (plainHexMatch) return raw.toLowerCase();

  return raw;
};

const getProductId = (item = {}) =>
  normalizeProductId(
    item.producto_id ??
      item.productoId ??
      item.product_id ??
      item.productId ??
      item.id ??
      item.codigo
  );

const getProductName = (item = {}) =>
  normalizeIdentifier(item.producto_nombre ?? item.nombre ?? item.name ?? item.descripcion).toLowerCase();

const buildRowIndex = () => {
  const byId = new Map();
  const byName = new Map();

  productRows.forEach((row, productId) => {
    byId.set(normalizeProductId(productId), row);
    byName.set(getProductName(row), row);
  });

  return { byId, byName };
};

const getVisibilityKey = (tenantId) => `cierre_inventarios_visibilidad_${tenantId || "global"}`;

const getVisibilitySettings = (tenantId) => {
  const stored = localStorage.getItem(getVisibilityKey(tenantId));
  if (!stored) return {};
  try {
    return JSON.parse(stored);
  } catch (error) {
    return {};
  }
};

const productRows = new Map();
let verified = false;
let empresaPolicy = {
  plan: "free",
  activa: true,
  solo_lectura: true
};

const setButtonState = ({ consultar, verificar, subir }) => {
  if (typeof consultar === "boolean") btnConsultar.disabled = !consultar;
  if (typeof verificar === "boolean") btnVerificar.disabled = !verificar;
  if (typeof subir === "boolean") btnSubir.disabled = !subir;
};

const aplicarPoliticaSoloLectura = () => {
  const isReadOnly = empresaPolicy?.solo_lectura === true;
  if (isReadOnly) {
    btnSubir.disabled = true;
    btnSubir.title = "Plan FREE: envio bloqueado";
    setStatus("Plan FREE activo: puedes consultar y visualizar, pero no subir cierres.");
  } else {
    btnSubir.title = "";
  }
};

const resetVerification = () => {
  verified = false;
  setButtonState({ subir: false });
};

const readRowsForWebhook = ({ includeHiddenAsZero = true } = {}) => {
  const rows = [];
  productRows.forEach((rowData, productId) => {
    const stockGastadoRaw = rowData.gastadoInput.value.trim();
    const stockGastado = stockGastadoRaw === "" ? 0 : Number(stockGastadoRaw);
    rows.push({
      producto_id: productId,
      producto_nombre: rowData.nombre,
      stock: Number(rowData.stockInput.value || 0),
      stock_gastado: Number.isNaN(stockGastado) ? 0 : stockGastado,
      restante: Number(rowData.restanteInput.value || 0),
      visible: rowData.visible,
      oculto: !rowData.visible,
      ...(includeHiddenAsZero && !rowData.visible
        ? { stock: 0, stock_gastado: 0, restante: 0 }
        : {})
    });
  });
  return rows;
};

const buildBasePayload = async () => {
  const contextPayload = await getContextPayload();
  if (!contextPayload) return null;

  return {
    ...contextPayload,
    fecha: fecha.value,
    hora_inicio: horaInicio.value,
    hora_fin: horaFin.value,
    responsable_id: responsable.value
  };
};

const loadResponsables = async () => {
  const contextPayload = await getContextPayload();
  if (!contextPayload) {
    setStatus("No se pudo validar la sesión.");
    return;
  }

  try {
    const empresaId = contextPayload.empresa_id || contextPayload.tenant_id;
    const { data, error } = await supabase
      .from("usuarios_sistema")
      .select("id, nombre_completo, activo")
      .eq("empresa_id", empresaId)
      .eq("activo", true)
      .order("nombre_completo", { ascending: true });
    const responsables = error ? [] : (Array.isArray(data) ? data : []);

    responsable.innerHTML = '<option value="">Seleccione responsable</option>';
    responsables.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id ?? "";
      option.textContent = item.nombre_completo ?? item.id ?? option.value;
      responsable.appendChild(option);
    });
  } catch (error) {
    setStatus("No se pudieron cargar responsables.");
  }
};

const fetchProductosConfigurados = async (contextPayload) => {
  const res = await fetchWithTimeout(WEBHOOK_CIERRE_INVENTARIOS_CARGAR_PRODUCTOS, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(contextPayload)
  });

  const data = await readResponseBody(res);
  if (!res.ok) throw new Error(data?.message || `Error cargando productos (HTTP ${res.status}).`);
  return normalizeList(data, ["productos", "items"]);
};

const getProductosVisibles = (productos, visibilidad) => {
  return productos.filter((item) => {
    if (!item || typeof item !== "object") return false;
    const productId = String(item.id ?? item.producto_id ?? item.codigo ?? "");
    if (!productId) return false;
    return visibilidad[productId] !== false;
  });
};

const renderProductRows = (productos) => {
  inventarioBody.innerHTML = "";
  productRows.clear();

  const fragment = document.createDocumentFragment();

  for (const item of productos) {
    const productId = String(item.id ?? item.producto_id ?? item.codigo ?? "");
    const nombre = item.nombre ?? item.name ?? item.descripcion ?? `Producto ${productId}`;

    const tr = document.createElement("tr");
    tr.dataset.productId = productId;

    const nombreCell = document.createElement("td");
    nombreCell.textContent = nombre;
    tr.appendChild(nombreCell);

    const stockCell = document.createElement("td");
    const stockInput = document.createElement("input");
    stockInput.type = "text";
    stockInput.className = "stock";
    stockInput.readOnly = true;
    stockInput.value = "0";
    stockCell.appendChild(stockInput);
    tr.appendChild(stockCell);

    const gastadoCell = document.createElement("td");
    const gastadoInput = document.createElement("input");
    gastadoInput.type = "text";
    gastadoInput.className = "stock-gastado";
    gastadoInput.value = "";
    gastadoCell.appendChild(gastadoInput);
    tr.appendChild(gastadoCell);

    const restanteCell = document.createElement("td");
    const restanteInput = document.createElement("input");
    restanteInput.type = "text";
    restanteInput.className = "restante";
    restanteInput.readOnly = true;
    restanteInput.value = "";
    restanteCell.appendChild(restanteInput);
    tr.appendChild(restanteCell);

    enforceNumericInput([gastadoInput]);
    gastadoInput.addEventListener("input", resetVerification);

    productRows.set(productId, {
      nombre,
      productId,
      stockInput,
      gastadoInput,
      restanteInput,
      visible: true
    });

    fragment.appendChild(tr);
  }

  inventarioBody.appendChild(fragment);
};

const renderProducts = async () => {
  const contextPayload = await getContextPayload();
  if (!contextPayload) {
    setStatus("No se pudo validar la sesión.");
    return;
  }

  setLoading(true, "Cargando configuración de visibilidad...");

  try {
    const visibilidad = getVisibilitySettings(contextPayload.tenant_id);
    setStatus("Cargando productos...");

    const productos = await fetchProductosConfigurados(contextPayload);
    const productosVisibles = getProductosVisibles(productos, visibilidad);

    setStatus("Construyendo tabla de productos...");
    renderProductRows(productosVisibles);

    setStatus(productRows.size ? "Productos cargados." : "No hay productos para mostrar.");
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    setStatus(timedOut
      ? "La carga tardó más de 5 segundos. Intenta nuevamente."
      : "Error al cargar productos.");
    console.error("Error renderizando cierre de inventarios:", error);
  } finally {
    setLoading(false);
  }
};


const validateRequiredFields = () => {
  if (!fecha.value || !responsable.value || !horaInicio.value || !horaFin.value) {
    setStatus("Atención: Completa fecha, responsable y turno.");
    return false;
  }
  if (!productRows.size) {
    setStatus("Atención: No hay productos cargados para operar.");
    return false;
  }
  return true;
};

btnConsultar.addEventListener("click", async () => {
  if (!validateRequiredFields()) return;

  const payload = await buildBasePayload();
  if (!payload) {
    setStatus("No se pudo validar la sesión.");
    return;
  }

  setStatus("Consultando stock...");

  try {
    const res = await fetch(WEBHOOK_CIERRE_INVENTARIOS_CONSULTAR, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        items: readRowsForWebhook()
      })
    });

    const data = await readResponseBody(res);
    if (!res.ok) {
      setStatus(data?.message || `Error consultando stock (HTTP ${res.status}).`);
      return;
    }
    const stocks = normalizeList(data, ["stocks", "productos", "items"]);
    const rowIndex = buildRowIndex();

    // El restante solo se debe poblar tras "Verificar".
    productRows.forEach((rowData) => {
      rowData.restanteInput.value = "";
    });

    stocks.forEach((item) => {
      const productId = getProductId(item);
      const productName = getProductName(item);
      const row = rowIndex.byId.get(productId) ?? rowIndex.byName.get(productName);
      if (!row) return;
      const stockValue = item.stock ?? item.stock_actual ?? item.value ?? 0;
      row.stockInput.value = String(stockValue);
    });

    setButtonState({ verificar: true });
    resetVerification();
    setStatus(data.ok === false ? "Consulta recibida con errores." : "Stock consultado.");
  } catch (error) {
    setStatus("Error consultando stock.");
  }
});

btnVerificar.addEventListener("click", () => {
  if (!validateRequiredFields()) return;

  let hasInvalidValue = false;

  productRows.forEach((rowData) => {
    const stockValue = Number(rowData.stockInput.value || 0);
    const gastadoRaw = rowData.gastadoInput.value.trim();
    const gastadoValue = gastadoRaw === "" ? 0 : Number(gastadoRaw);

    if (Number.isNaN(stockValue) || Number.isNaN(gastadoValue)) {
      hasInvalidValue = true;
      return;
    }

    const restante = stockValue - gastadoValue;
    rowData.restanteInput.value = String(restante);
  });

  if (hasInvalidValue) {
    verified = false;
    setButtonState({ subir: false });
    setStatus("Atención: Hay valores inválidos en stock o stock gastado.");
    return;
  }

  verified = true;
  setButtonState({ subir: true });
  setStatus("Verificación completada.");
});

btnSubir.addEventListener("click", async () => {
  if (empresaPolicy?.solo_lectura === true) {
    setStatus("Plan FREE: no se permite subir cierres de inventario.");
    return;
  }

  if (!verified) {
    setStatus("Atención: Primero debes verificar los datos.");
    return;
  }

  const payload = await buildBasePayload();
  if (!payload) {
    setStatus("No se pudo validar la sesión.");
    return;
  }

  const writeAllowed = await puedeEnviarDatos(payload?.empresa_id, true).catch(() => false);
  if (!writeAllowed) {
    setStatus("Plan FREE o empresa inactiva: envio bloqueado por seguridad.");
    return;
  }

  setStatus("Subiendo cierre de inventarios...");

  try {
    const res = await fetch(WEBHOOK_CIERRE_INVENTARIOS_SUBIR, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        items: readRowsForWebhook()
      })
    });

    const raw = await res.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (_parseError) {
      data = { message: raw };
    }

    if (!res.ok) {
      console.error("Error webhook cierre_inventarios_subir", { status: res.status, data });
      setStatus(data?.message || `Error subiendo datos (HTTP ${res.status}).`);
      return;
    }

    setStatus(data.message || (data.ok ? "Datos subidos correctamente." : "El webhook devolvio error."));
  } catch (error) {
    setStatus("Error subiendo datos.");
  }
});



const descargarImagenInventario = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    setStatus("No se pudo generar la imagen del cierre inventarios.");
    return;
  }

  const empresaNombre = nombreEmpresaActual || "Empresa";
  const responsableTexto = responsable?.selectedOptions?.[0]?.textContent || "-";
  const marcaAxioma = "AXIOMA by Global Nexo Shop";
  const fechaExpedicion = new Date().toLocaleDateString("es-CO");

  ctx.fillStyle = "#eef2ff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cardX = 46;
  const cardY = 46;
  const cardW = canvas.width - 92;
  const cardH = canvas.height - 92;

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#93c5fd";
  ctx.lineWidth = 4;
  ctx.fillRect(cardX, cardY, cardW, cardH);
  ctx.strokeRect(cardX, cardY, cardW, cardH);

  let y = cardY + 54;
  ctx.fillStyle = "#1e3a8a";
  ctx.font = "bold 42px Arial";
  ctx.fillText("CIERRE INVENTARIOS", cardX + 36, y);

  ctx.textAlign = "right";
  ctx.fillStyle = "#1d4ed8";
  ctx.font = "bold 34px Arial";
  ctx.fillText(empresaNombre, cardX + cardW - 36, y);
  ctx.font = "bold 20px Arial";
  ctx.fillStyle = "#4338ca";
  ctx.fillText(marcaAxioma, cardX + cardW - 36, y + 34);
  ctx.textAlign = "left";

  y += 52;
  ctx.fillStyle = "#334155";
  ctx.font = "28px Arial";
  ctx.fillText(`Fecha: ${fecha.value || "-"}`, cardX + 36, y);
  y += 38;
  ctx.fillText(`Responsable: ${responsableTexto}`, cardX + 36, y);
  y += 38;
  ctx.fillText(`Inicio/Fin: ${horaInicio.value || "-"} / ${horaFin.value || "-"}`, cardX + 36, y);

  y += 52;
  const tableX = cardX + 28;
  const tableW = cardW - 56;
  const cols = [0.42, 0.19, 0.19, 0.20].map((r) => Math.floor(tableW * r));
  const rowH = 40;

  const drawRow = (rowY, values, header = false) => {
    let x = tableX;
    ctx.fillStyle = header ? "#dbeafe" : "#ffffff";
    ctx.strokeStyle = "#bfdbfe";
    ctx.fillRect(tableX, rowY, tableW, rowH);
    ctx.strokeRect(tableX, rowY, tableW, rowH);

    values.forEach((value, index) => {
      if (index > 0) {
        ctx.beginPath();
        ctx.moveTo(x, rowY);
        ctx.lineTo(x, rowY + rowH);
        ctx.stroke();
      }
      ctx.fillStyle = "#1f2937";
      ctx.font = header ? "bold 19px Arial" : "18px Arial";
      ctx.fillText(String(value), x + 8, rowY + 26);
      x += cols[index];
    });
  };

  drawRow(y, ["Producto", "Sistema", "Gastado", "Restante"], true);
  y += rowH;

  const rows = Array.from(productRows.values());
  (rows.length ? rows : [{ nombre: "Sin productos", stockInput: { value: 0 }, gastadoInput: { value: 0 }, restanteInput: { value: 0 } }])
    .forEach((row) => {
      drawRow(y, [
        row.nombre || "Producto",
        row.stockInput?.value || 0,
        row.gastadoInput?.value || 0,
        row.restanteInput?.value || 0
      ]);
      y += rowH;
    });

  const selloY = cardY + cardH - 30;
  ctx.textAlign = "center";
  ctx.fillStyle = "#4338ca";
  ctx.font = "bold 20px Arial";
  ctx.fillText(`Expedido por AXIOMA by Global Nexo Shop (${fechaExpedicion})`, cardX + (cardW / 2), selloY);
  ctx.textAlign = "left";

  const link = document.createElement("a");
  const fechaNombre = (fecha.value || new Date().toISOString().slice(0, 10));
  link.download = `cierre_inventarios_${fechaNombre}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();

  setStatus("Imagen del cierre inventarios descargada.");
};

btnDescargarImagen?.addEventListener("click", () => {
  descargarImagenInventario();
});

btnLimpiar.addEventListener("click", () => {
  productRows.forEach((rowData) => {
    rowData.stockInput.value = "0";
    rowData.gastadoInput.value = "";
    rowData.restanteInput.value = "";
  });
  resetVerification();
  setButtonState({ verificar: false });
  setStatus("Datos limpiados.");
});

[fecha, responsable, horaInicio, horaFin].forEach((element) => {
  element.addEventListener("change", resetVerification);
});

setButtonState({ consultar: true, verificar: false, subir: false });
cargarPoliticaEmpresa();
loadResponsables();
renderProducts();
cargarNombreEmpresa();

