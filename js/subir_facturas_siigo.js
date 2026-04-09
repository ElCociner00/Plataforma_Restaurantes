import { getUserContext } from "./session.js";
import { supabase } from "./supabase.js";
import {
  WEBHOOK_SUBIR_SIIGO,
  WEBHOOK_CORREGIR_FACTURA_INCONVENIENTE,
  WEBHOOK_CARGAR_FACTURAS_CORREO
} from "./webhooks.js";

const head = document.getElementById("facturasHead");
const body = document.getElementById("facturasBody");
const detalleFactura = document.getElementById("detalleFactura");
const status = document.getElementById("status");
const paginacion = document.getElementById("facturasPaginacion");
const inconvenientesAviso = document.getElementById("inconvenientesAviso");
const tabFacturasListas = document.getElementById("tabFacturasListas");
const tabFacturasRevision = document.getElementById("tabFacturasRevision");
const tabFacturasCorregidas = document.getElementById("tabFacturasCorregidas");
const revisionDot = document.getElementById("revisionDot");
const accionesCorreccionWrap = document.getElementById("accionesCorreccionWrap");
const nombreCuentaWrap = document.getElementById("nombreCuentaWrap");
const nombreCuentaContable = document.getElementById("nombreCuentaContable");
const corregirFacturaActualBtn = document.getElementById("corregirFacturaActual");
const corregirRegistrarProveedorBtn = document.getElementById("corregirRegistrarProveedor");

const filtroFechaDesde = document.getElementById("filtroFechaDesde");
const filtroFechaHasta = document.getElementById("filtroFechaHasta");
const filtroNumero = document.getElementById("filtroNumero");
const filtroProveedor = document.getElementById("filtroProveedor");
const filtroNit = document.getElementById("filtroNit");

const btnAplicarFiltros = document.getElementById("aplicarFiltros");
const btnLimpiarFiltros = document.getElementById("limpiarFiltros");
const modoDescarga = document.getElementById("modoDescarga");
const btnDescargarFacturas = document.getElementById("descargarFacturas");
const btnCargarTodasFacturas = document.getElementById("cargarTodasFacturas");

const getTimestamp = () => new Date().toISOString();
const DETAILS_ORDER_KEY = "siigo_facturas_detalle_order";
const PAGE_SIZE = 30;
const SWITCH_DELAY_MS = 1000;
const FUZZY_THRESHOLD_NUMERO = 0.9;
const FUZZY_THRESHOLD_NIT = 0.85;

const state = {
  context: null,
  allRows: [],
  readyRows: [],
  reviewRows: [],
  correctedRows: [],
  filteredRows: [],
  selectedId: null,
  currentPage: 1,
  panelMode: "listas",
  generalColumns: [
    "numero_factura", "fecha_iso", "proveedor", "nit", "tipo_factura", "iva", "inc", "total", "estado_siigo"
  ],
  detailColumns: [
    "producto", "cantidad", "valor_unitario", "subtotal", "valor_impuesto", "codigo_contable", "valor_debito", "valor_credito"
  ],
  detailOrderByInvoice: {},
  switchQueue: Promise.resolve(),
  switchQueueCount: 0,
  switchErrorByInvoice: {},
  correctionMode: null,
  correctionTargetId: null
};

const setStatus = (message) => { status.textContent = message; };
const format = (v) => (v === null || v === undefined || v === "" ? "-" : String(v));
const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");
const escapeAttr = (value) => escapeHtml(value).replaceAll("`", "&#96;");

const DEACTIVATE_WARNING_MESSAGE = "Desactivar este switch no eliminará la factura de siigo y puede generar problemas o confusiones, estas seguro de desactivar? recuerda que para borrar un comprobante debes hacerlo desde la plataforma.";

const normalizeBoolean = (value) => {
  if (typeof value === "boolean") return value;
  const text = String(value || "").toLowerCase().trim();
  return text === "true" || text === "1" || text === "si" || text === "sí" || text === "subida" || text === "cargada";
};

const getInvoiceState = (row) => normalizeBoolean(row?.siigo_subido);

const ensureWarningModal = () => {
  let modal = document.getElementById("siigoDeactivateWarningModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "siigoDeactivateWarningModal";
  modal.className = "siigo-warning-modal hidden";
  modal.innerHTML = `
    <div class="siigo-warning-card" role="dialog" aria-modal="true" aria-labelledby="siigoWarningTitle">
      <h3 id="siigoWarningTitle">Advertencia</h3>
      <p>${DEACTIVATE_WARNING_MESSAGE}</p>
      <div class="siigo-warning-actions">
        <button type="button" class="siigo-warning-cancel" data-warning-cancel>Cancelar</button>
        <button type="button" class="siigo-warning-confirm" data-warning-confirm>Desactivar</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
};

const requestDeactivateConfirmation = () => new Promise((resolve) => {
  const modal = ensureWarningModal();
  modal.classList.remove("hidden");

  const close = (result) => {
    modal.classList.add("hidden");
    modal.removeEventListener("click", onBackdrop);
    cancelBtn?.removeEventListener("click", onCancel);
    confirmBtn?.removeEventListener("click", onConfirm);
    resolve(result);
  };

  const onBackdrop = (event) => {
    if (event.target === modal) close(false);
  };

  const onCancel = () => close(false);
  const onConfirm = () => close(true);

  const cancelBtn = modal.querySelector("[data-warning-cancel]");
  const confirmBtn = modal.querySelector("[data-warning-confirm]");

  modal.addEventListener("click", onBackdrop);
  cancelBtn?.addEventListener("click", onCancel);
  confirmBtn?.addEventListener("click", onConfirm);
});


const normalizeRows = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const keys = ["rows", "data", "items", "facturas", "result"];
  for (const key of keys) {
    if (Array.isArray(raw[key])) return raw[key];
  }
  return [];
};

const safeParseJson = (value, fallback) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const normalizeText = (value) => String(value || "").toUpperCase().trim();

const toReadableLabel = (value) => String(value || "")
  .replace(/[_-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const createExpandableCellContent = (value, maxChars = 42) => {
  const wrapper = document.createElement("div");
  wrapper.className = "cell-expandable";

  const text = String(value ?? "-");
  const textSpan = document.createElement("span");
  textSpan.className = "cell-expandable-text";
  textSpan.textContent = text;

  if (text.length <= maxChars) {
    wrapper.appendChild(textSpan);
    return wrapper;
  }

  textSpan.classList.add("is-collapsed");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "cell-expandable-toggle";
  toggle.textContent = "Ver más";

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const collapsed = textSpan.classList.toggle("is-collapsed");
    toggle.textContent = collapsed ? "Ver más" : "Ver menos";
  });

  wrapper.appendChild(textSpan);
  wrapper.appendChild(toggle);
  return wrapper;
};

const levenshteinDistance = (a, b) => {
  const first = normalizeText(a);
  const second = normalizeText(b);

  if (!first.length) return second.length;
  if (!second.length) return first.length;

  const matrix = Array.from({ length: first.length + 1 }, () => new Array(second.length + 1).fill(0));

  for (let i = 0; i <= first.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= second.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= first.length; i += 1) {
    for (let j = 1; j <= second.length; j += 1) {
      const cost = first[i - 1] === second[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[first.length][second.length];
};

const similarityScore = (query, candidate) => {
  const q = normalizeText(query);
  const c = normalizeText(candidate);
  if (!q && !c) return 1;
  if (!q || !c) return 0;
  if (c.includes(q)) return 1;

  const distance = levenshteinDistance(q, c);
  const maxLen = Math.max(q.length, c.length);
  return maxLen ? 1 - distance / maxLen : 0;
};

const parseInvoiceCode = (value) => {
  const match = normalizeText(value).match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  return { prefix: match[1], number: Number(match[2]) };
};

const invoiceSimilarityScore = (query, candidate) => {
  const base = similarityScore(query, candidate);
  const qCode = parseInvoiceCode(query);
  const cCode = parseInvoiceCode(candidate);

  if (!qCode || !cCode || qCode.prefix !== cCode.prefix) return base;

  const diff = Math.abs(qCode.number - cCode.number);
  const neighborScore = Math.max(0, 1 - diff / 100);
  return Math.max(base, neighborScore);
};

const buildContextPayload = () => ({
  tenant_id: state.context?.empresa_id,
  empresa_id: state.context?.empresa_id,
  usuario_id: state.context?.user?.id || state.context?.user?.user_id,
  rol: state.context?.rol,
  timestamp: getTimestamp()
});

const getResponsableId = () => state.context?.user?.id || state.context?.user?.user_id || "";

const parseWebhookResponse = async (res) => {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  const text = await res.text();
  if (!text) return { ok: res.ok };
  try {
    return JSON.parse(text);
  } catch {
    return { message: text, ok: res.ok };
  }
};

const fetchJson = async (url, payload, method = "POST") => {
  const requestUrl = method === "GET" && payload
    ? `${url}?${new URLSearchParams(payload).toString()}`
    : url;

  const res = await fetch(requestUrl, {
    method,
    headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(payload) : undefined
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseWebhookResponse(res);
};

const fetchWebhookSignal = async (url, payload) => {
  const asStringEntries = Object.entries(payload).map(([k, v]) => [k, typeof v === "boolean" ? String(v) : String(v ?? "")]);
  const query = new URLSearchParams(asStringEntries);

  const attempts = [
    async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: query.toString()
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseWebhookResponse(res);
    },
    async () => fetchJson(url, payload, "POST"),
    async () => fetchJson(url, payload, "GET")
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("No se pudo enviar señal al webhook.");
};

const fetchWebhookWithFallback = async (url, payload) => {
  try {
    return await fetchJson(url, payload, "POST");
  } catch {
    return fetchJson(url, payload, "GET");
  }
};

const GENERAL_VIEW_COLUMNS = [
  "empresa_id",
  "UUID",
  "Tipo de documento",
  "Prefijo",
  "Consecutivo",
  "Fecha Emisión",
  "NIT Emisor",
  "Nombre Emisor",
  "IVA",
  "INC",
  "Total",
  "Estado_Siigo"
];

const DETAIL_TABLE_COLUMNS = [
  "id",
  "uuid_factura",
  "Prefijo Factura",
  "Consecutivo Factura",
  "Proveedor",
  "Dirección",
  "Télefono",
  "Correo Empresa",
  "Producto",
  "Valor Unitario",
  "Cantidad",
  "Subtotal",
  "Porcentaje INC o IVA",
  "Código Contable",
  "Valor Débito",
  "Valor Crédito",
  "Estado",
  "Tipo de Factura",
  "Fecha Factura",
  "NIT_CC",
  "Estado_Siigo"
];

const DETAIL_TABLE_COLUMNS_FALLBACK = [
  "id",
  "uuid_factura",
  "Producto",
  "Valor Unitario",
  "Cantidad",
  "Subtotal",
  "Porcentaje INC o IVA",
  "Código Contable",
  "Valor Débito",
  "Valor Crédito",
  "Estado",
  "Tipo de Factura",
  "Fecha Factura",
  "NIT_CC",
  "Estado_Siigo"
];

const INCONVENIENTES_TABLE_COLUMNS = [
  "id",
  "uuid_factura",
  "Proveedor",
  "Producto",
  "Cantidad",
  "Valor Unitario",
  "Subtotal",
  "Código Contable",
  "Valor Débito",
  "Valor Crédito",
  "Estado",
  "Tipo de Factura",
  "Fecha Factura",
  "NIT_CC",
  "Estado_Resuelto"
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const invoiceId = (row, idx) => `${row.numero_factura || "sin-numero"}-${idx}`;

const safeNumber = (value) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

const normalizeDateString = (value) => {
  if (!value) return "";
  const normalized = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  const dmy = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, "0");
    const month = dmy[2].padStart(2, "0");
    const year = dmy[3];
    return `${year}-${month}-${day}`;
  }
  const dateObj = new Date(normalized);
  if (Number.isNaN(dateObj.getTime())) return normalized;
  return dateObj.toISOString().slice(0, 10);
};

const toSelectColumns = (columns = []) => columns
  .map((column) => (column.match(/^[a-z_][a-z0-9_]*$/i) ? column : `"${column}"`))
  .join(", ");

const sortByDateDesc = (rows = [], key) => [...rows].sort((a, b) => {
  const aDate = new Date(String(a?.[key] || ""));
  const bDate = new Date(String(b?.[key] || ""));
  const aTime = Number.isNaN(aDate.getTime()) ? 0 : aDate.getTime();
  const bTime = Number.isNaN(bDate.getTime()) ? 0 : bDate.getTime();
  return bTime - aTime;
});

const fetchFacturasGenerales = async () => {
  const empresaId = state.context?.empresa_id;
  if (!empresaId) return [];
  const views = ["vista_facturas_agrupadas", "vista_facturas_agrupadas_empresa"];
  let lastError = null;

  for (const viewName of views) {
    const response = await supabase
      .from(viewName)
      .select(toSelectColumns(GENERAL_VIEW_COLUMNS))
      .eq("empresa_id", String(empresaId));

    if (response.error) {
      lastError = response.error;
      continue;
    }

    const rows = Array.isArray(response.data) ? response.data : [];
    return sortByDateDesc(rows, "Fecha Emisión");
  }

  throw lastError || new Error("No se pudo consultar la vista de facturas.");
};

const fetchFacturasDetalles = async (uuids = []) => {
  if (!uuids.length) return [];
  const empresaId = state.context?.empresa_id;
  if (!empresaId) return [];

  const runQuery = async (columns) => supabase
    .from("facturas_empresas")
    .select(toSelectColumns(columns))
    .in("uuid_factura", uuids)
    .eq("empresa_id", empresaId);

  let response = await runQuery(DETAIL_TABLE_COLUMNS);
  if (response.error) {
    // Fallback si cambió el schema y faltan columnas opcionales (ej. Dirección, Télefono, Correo Empresa).
    response = await runQuery(DETAIL_TABLE_COLUMNS_FALLBACK);
  }

  if (response.error) throw response.error;
  return sortByDateDesc(Array.isArray(response.data) ? response.data : [], "Fecha Factura");
};

const fetchFacturasInconvenientes = async (resolved) => {
  const empresaId = state.context?.empresa_id;
  if (!empresaId) return [];

  const { data, error } = await supabase
    .from("facturas_empresas_inconvenientes")
    .select(toSelectColumns(INCONVENIENTES_TABLE_COLUMNS))
    .eq("empresa_id", empresaId)
    .eq("Estado_Resuelto", resolved);

  if (error) throw error;
  return sortByDateDesc(Array.isArray(data) ? data : [], "Fecha Factura");
};

const parseNumericText = (value) => {
  if (value == null) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const pickValue = (row, keys = []) => {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== "") return row[key];
  }
  return "";
};

const unwrapWebhookRow = (item) => {
  if (!item || typeof item !== "object") return item;
  if (item.json && typeof item.json === "object") return item.json;
  if (item.data && typeof item.data === "object" && !Array.isArray(item.data)) return item.data;
  return item;
};

const buildRowsFromWebhookRaw = (rawRows = []) => {
  const normalizedRows = rawRows.map(unwrapWebhookRow).filter((item) => item && typeof item === "object");
  const isGroupedShape = normalizedRows.length > 0
    && (normalizedRows[0]?.UUID || normalizedRows[0]?.["Tipo de documento"] || normalizedRows[0]?.["Fecha Emisión"]);

  if (isGroupedShape) {
    return normalizedRows.map((row, idx) => {
      const invoice = normalizeInvoiceGeneral({
        UUID: row.UUID || row.uuid_factura || "",
        Prefijo: row.Prefijo || row["Prefijo Factura"] || "",
        Consecutivo: row.Consecutivo || row["Consecutivo Factura"] || "",
        "Fecha Emisión": row["Fecha Emisión"] || row["Fecha Factura"] || "",
        "Nombre Emisor": row["Nombre Emisor"] || row.Proveedor || "",
        "NIT Emisor": row["NIT Emisor"] || row.NIT_CC || "",
        "Tipo de documento": row["Tipo de documento"] || row["Tipo de Factura"] || "",
        IVA: row.IVA ?? row["Valor IVA"] ?? 0,
        INC: row.INC ?? row["Valor INC"] ?? 0,
        Total: row.Total ?? row["Valor Total"] ?? 0,
        Estado_Siigo: normalizeBoolean(row["Estado_Siigo"])
      }, [], [], "lista");
      return { ...invoice, __id: invoiceId(invoice, idx) };
    });
  }

  const IVA_CODES = new Set(["24080101", "24080501"]);
  const INC_CODES = new Set(["24080102"]);

  const grouped = new Map();
  normalizedRows.forEach((item) => {
    const uuid = String(item?.uuid_factura || item?.UUID || item?.uuid || "").trim();
    if (!uuid) return;
    if (!grouped.has(uuid)) grouped.set(uuid, []);
    grouped.get(uuid).push(item);
  });

  return Array.from(grouped.entries()).map(([uuid, items], idx) => {
    const first = items[0] || {};
    const prefijo = first["Prefijo Factura"] || first.Prefijo || "";
    const consecutivo = first["Consecutivo Factura"] || first.Consecutivo || "";
    const numeroFactura = `${prefijo}${consecutivo}`.trim() || uuid;
    const fecha = first["Fecha Factura"] || first["Fecha Emisión"] || "";
    const iva = items.reduce((acc, row) => {
      const code = String(row["Código Contable"] || "");
      return acc + (IVA_CODES.has(code) ? parseNumericText(row["Valor Débito"]) : 0);
    }, 0);
    const inc = items.reduce((acc, row) => {
      const code = String(row["Código Contable"] || "");
      return acc + (INC_CODES.has(code) ? parseNumericText(row["Valor Débito"]) : 0);
    }, 0);
    const totalFromCredits = items.reduce((acc, row) => {
      const code = String(row["Código Contable"] || "");
      if (IVA_CODES.has(code) || INC_CODES.has(code)) return acc;
      return acc + parseNumericText(row["Valor Crédito"]);
    }, 0);
    const totalFromSubtotals = items.reduce((acc, row) => acc + parseNumericText(row.Subtotal), 0);
    const total = totalFromCredits > 0 ? totalFromCredits : totalFromSubtotals;

    const details = items.map((detail) => ({
      ...detail,
      id: detail.id || crypto.randomUUID(),
      uuid_factura: uuid
    }));

    const invoice = normalizeInvoiceGeneral({
      UUID: uuid,
      Prefijo: prefijo,
      Consecutivo: consecutivo,
      "Fecha Emisión": fecha,
      "Nombre Emisor": first["Proveedor"] || first["Nombre Emisor"] || "",
      "NIT Emisor": first["NIT_CC"] || first["NIT Emisor"] || "",
      "Tipo de documento": first["Tipo de Factura"] || first["Tipo de documento"] || "",
      IVA: iva,
      INC: inc,
      Total: total,
      Estado_Siigo: normalizeBoolean(first["Estado_Siigo"])
    }, details, [], "lista");

    return { ...invoice, __id: invoiceId(invoice, idx) };
  });
};

const loadFacturasFromWebhookFallback = async () => {
  if (!WEBHOOK_CARGAR_FACTURAS_CORREO) {
    throw new Error("No hay webhook de emergencia configurado para cargar facturas.");
  }

  const payload = buildContextPayload();
  const response = await fetchWebhookWithFallback(WEBHOOK_CARGAR_FACTURAS_CORREO, payload);
  const rawRows = normalizeRows(response);
  return sortByDateDesc(buildRowsFromWebhookRaw(rawRows), "fecha_iso");
};

const normalizeInvoiceDetail = (row = {}, source = "principal") => ({
  id_unico: row.id || crypto.randomUUID(),
  source,
  editable_codigo: source !== "principal",
  producto: pickValue(row, ["Producto", "producto", "item", "descripcion_producto"]),
  cantidad: pickValue(row, ["Cantidad", "cantidad"]),
  valor_unitario: pickValue(row, ["Valor Unitario", "valor_unitario"]),
  subtotal: pickValue(row, ["Subtotal", "subtotal"]),
  valor_impuesto: pickValue(row, ["Porcentaje INC o IVA", "porcentaje_inc_o_iva", "valor_impuesto"]),
  codigo_contable: pickValue(row, ["Código Contable", "Codigo Contable", "codigo_contable"]),
  codigo_contable_original: pickValue(row, ["Código Contable", "Codigo Contable", "codigo_contable"]),
  valor_debito: pickValue(row, ["Valor Débito", "Valor Debito", "valor_debito"]),
  valor_credito: pickValue(row, ["Valor Crédito", "Valor Credito", "valor_credito"]),
  descripcion: pickValue(row, ["Descripción", "Descripcion", "Detalle", "detalle"])
});

const normalizeInvoiceGeneral = (row = {}, details = [], inconvenientes = [], estadoRevision = "lista") => {
  const prefijo = row["Prefijo"] || "";
  const consecutivo = row["Consecutivo"] || "";
  const numeroFactura = `${prefijo}${consecutivo}`.trim();
  const firstDetail = details[0] || {};
  const estadoSiigo = normalizeBoolean(row["Estado_Siigo"]);

  return {
    factura_uuid: row["UUID"] || "",
    numero_factura: numeroFactura || row["UUID"] || "-",
    prefijo_factura: prefijo,
    consecutivo_factura: consecutivo,
    fecha_iso: normalizeDateString(row["Fecha Emisión"]),
    proveedor: row["Nombre Emisor"] || "",
    nit: row["NIT Emisor"] || "",
    direccion: pickValue(firstDetail, ["Dirección", "Direccion", "direccion"]),
    telefono: pickValue(firstDetail, ["Télefono", "Telefono", "telefono"]),
    correo_empresa: pickValue(firstDetail, ["Correo Empresa", "correo_empresa"]),
    estado: pickValue(firstDetail, ["Estado", "estado"]) || "no_registrado",
    tipo_factura: row["Tipo de documento"] || firstDetail["Tipo de Factura"] || "",
    iva: safeNumber(row["IVA"]),
    inc: safeNumber(row["INC"]),
    total: safeNumber(row["Total"]),
    estado_siigo: estadoSiigo ? "Subida" : "Pendiente",
    total_items: details.length,
    siigo_subido: estadoSiigo,
    estado_revision: estadoRevision,
    items: [
      ...details.map((item) => normalizeInvoiceDetail(item, "principal")),
      ...inconvenientes.map((item) => normalizeInvoiceDetail(item, "inconveniente"))
    ]
  };
};

const detailRowWeight = (item) => {
  const name = String(item.producto || "").trim().toUpperCase();
  const hasCredit = Number(item.valor_credito || 0) > 0;
  if (hasCredit || name.includes("CREDITO") || name.includes("BANCO")) return 2;
  if (name === "IMPUESTO" || name.includes("IMPUESTO")) return 1;
  return 0;
};

const baseSortDetails = (items = []) => [...items].sort((a, b) => detailRowWeight(a) - detailRowWeight(b));

const getPaginatedRows = () => {
  const start = (state.currentPage - 1) * PAGE_SIZE;
  return state.filteredRows.slice(start, start + PAGE_SIZE);
};

const getRowsByMode = () => {
  if (state.panelMode === "revision") return state.reviewRows;
  if (state.panelMode === "corregidas") return state.correctedRows;
  return state.readyRows;
};

const isCorrectionEditingEnabled = (invoiceIdValue) => {
  if (state.panelMode !== "revision") return false;
  if (!state.correctionMode) return false;
  return state.correctionTargetId === invoiceIdValue;
};

const renderPanelIndicators = () => {
  const reviewCount = state.reviewRows.length;
  revisionDot?.classList.toggle("hidden", reviewCount <= 0);

  if (inconvenientesAviso) {
    if (reviewCount > 0) {
      inconvenientesAviso.classList.remove("hidden");
      inconvenientesAviso.textContent = `Atención: hay ${reviewCount} factura(s) con inconvenientes para revisión.`;
    } else {
      inconvenientesAviso.classList.add("hidden");
      inconvenientesAviso.textContent = "";
    }
  }

  [
    [tabFacturasListas, "listas"],
    [tabFacturasRevision, "revision"],
    [tabFacturasCorregidas, "corregidas"]
  ].forEach(([button, mode]) => {
    button?.classList.toggle("active", state.panelMode === mode);
  });

  accionesCorreccionWrap?.classList.toggle("hidden", state.panelMode !== "revision");
  const needsAccountName = state.panelMode === "revision" && state.correctionMode === "corregir_y_registrar_proveedor";
  nombreCuentaWrap?.classList.toggle("hidden", !needsAccountName);
};

const getDetailsByInvoice = (invoice) => {
  const base = baseSortDetails(Array.isArray(invoice?.items) ? invoice.items : []);
  const saved = state.detailOrderByInvoice[invoice?.__id];
  if (!Array.isArray(saved) || !saved.length) return base;

  const map = new Map(base.map((item, index) => [String(item.id_unico || `${item.producto}-${index}`), item]));
  const ordered = [];
  saved.forEach((id) => {
    if (map.has(id)) {
      ordered.push(map.get(id));
      map.delete(id);
    }
  });
  map.forEach((item) => ordered.push(item));
  return ordered;
};

const getDetailsByInvoiceId = (id) => {
  const invoice = state.allRows.find((row) => row.__id === id);
  if (!invoice) return [];
  return getDetailsByInvoice(invoice);
};

const createDetailInlineRow = (row) => {
  const detailTr = document.createElement("tr");
  detailTr.className = "detail-inline-row";

  const detailTd = document.createElement("td");
  detailTd.colSpan = state.generalColumns.length + 1;
  detailTd.innerHTML = buildDetailTableHtml(row.__id);

  detailTr.appendChild(detailTd);
  return detailTr;
};

const bindInlineDetailDrag = () => {
  let draggingKey = null;
  const rows = body.querySelectorAll("tr[data-detail-key]");
  rows.forEach((tr) => {
    tr.addEventListener("dragstart", () => {
      draggingKey = tr.dataset.detailKey;
      tr.classList.add("dragging");
    });
    tr.addEventListener("dragend", () => tr.classList.remove("dragging"));
    tr.addEventListener("dragover", (event) => event.preventDefault());
    tr.addEventListener("drop", () => {
      const targetKey = tr.dataset.detailKey;
      if (!draggingKey || !targetKey || draggingKey === targetKey) return;
      const current = getDetailsByInvoiceId(state.selectedId)
        .map((item, idx) => String(item.id_unico || `${item.producto}-${idx}`));
      const from = current.indexOf(draggingKey);
      const to = current.indexOf(targetKey);
      if (from < 0 || to < 0) return;

      const next = [...current];
      next.splice(to, 0, next.splice(from, 1)[0]);
      state.detailOrderByInvoice[state.selectedId] = next;
      localStorage.setItem(DETAILS_ORDER_KEY, JSON.stringify(state.detailOrderByInvoice));
      renderTable();
      updateDetailStatusText();
    });
  });
};

const buildDetailTableHtml = (invoiceIdValue) => {
  const items = getDetailsByInvoiceId(invoiceIdValue);
  const detailHead = ["↕", "origen", ...state.detailColumns].map((col) => `<th>${toReadableLabel(col)}</th>`).join("");

  if (!items.length) {
    return `
      <div class="inline-detail-wrap">
        <table class="inline-detail-table">
          <thead><tr>${detailHead}</tr></thead>
          <tbody><tr><td colspan="${state.detailColumns.length + 2}">Sin items.</td></tr></tbody>
        </table>
      </div>
    `;
  }

  const detailRows = items.map((item, idx) => {
    const key = String(item.id_unico || `${item.producto}-${idx}`);
    const cols = state.detailColumns.map((col) => {
      if (col === "codigo_contable" && item.editable_codigo && isCorrectionEditingEnabled(invoiceIdValue)) {
        return `<td><input data-codigo-edit="${escapeAttr(key)}" type="text" value="${escapeAttr(item[col] || "")}" placeholder="Código contable"></td>`;
      }
      return `<td>${escapeHtml(format(item[col]))}</td>`;
    }).join("");
    const origen = item.source === "inconveniente" ? "Inconveniente" : "Principal";
    return `<tr draggable="true" data-detail-key="${escapeAttr(key)}"><td class="drag-col">⋮⋮</td><td>${origen}</td>${cols}</tr>`;
  }).join("");

  return `
    <div class="inline-detail-wrap">
      <table class="inline-detail-table">
        <thead><tr>${detailHead}</tr></thead>
        <tbody>${detailRows}</tbody>
      </table>
    </div>
  `;
};

const updateDetailStatusText = () => {
  if (!detalleFactura) return;
  const selected = state.allRows.find((row) => row.__id === state.selectedId);
  const modeLabel = state.panelMode === "revision"
    ? "revisión"
    : state.panelMode === "corregidas"
      ? "corregidas"
      : "listas";
  detalleFactura.textContent = selected
    ? `Detalle de ${format(selected.numero_factura)} (${modeLabel}) visible debajo de la fila seleccionada.`
    : "Selecciona una factura para ver items debajo de su fila.";
};

const bindColumnDrag = () => {
  head.querySelectorAll("th[data-column]").forEach((th) => {
    th.draggable = true;
    th.addEventListener("dragstart", () => th.classList.add("dragging"));
    th.addEventListener("dragend", () => th.classList.remove("dragging"));
    th.addEventListener("dragover", (event) => event.preventDefault());
    th.addEventListener("drop", () => {
      const source = head.querySelector("th.dragging")?.dataset.column;
      const target = th.dataset.column;
      if (!source || !target || source === target) return;
      const from = state.generalColumns.indexOf(source);
      const to = state.generalColumns.indexOf(target);
      if (from < 0 || to < 0) return;
      const next = [...state.generalColumns];
      next.splice(to, 0, next.splice(from, 1)[0]);
      state.generalColumns = next;
      renderTable();
    });
  });
};

const renderPagination = () => {
  if (!paginacion) return;
  paginacion.innerHTML = "";

  const totalPages = Math.max(1, Math.ceil(state.filteredRows.length / PAGE_SIZE));
  for (let page = 1; page <= totalPages; page += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(page);
    if (page === state.currentPage) button.classList.add("active");

    button.addEventListener("click", () => {
      state.currentPage = page;
      renderTable();
    });
    paginacion.appendChild(button);
  }
};


const runSwitchUpdate = async (row, checked) => {
  const payload = {
    tenant_id: state.context?.empresa_id,
    empresa_id: state.context?.empresa_id,
    usuario_id: getResponsableId(),
    responsable_id: getResponsableId(),
    rol: state.context?.rol,
    timestamp: getTimestamp(),
    timestampwithtimezone: getTimestamp(),
    accion_subir_siigo: checked,
    subir_siigo: checked,
    ok: checked,
    numero_factura: row.numero_factura,
    fecha_factura: row.fecha_iso || null,
    uuid_factura: row.factura_uuid || null,
    prefijo_factura: row.prefijo_factura || null,
    consecutivo_factura: row.consecutivo_factura || null,
    factura_id: row.factura_id || row.id || row.__id,
    nit: row.nit || null,
    proveedor: row.proveedor || null,
    tipo_factura: row.tipo_factura || null,
    estado_factura: row.estado || null,
    webhook_origen: WEBHOOK_SUBIR_SIIGO
  };

  const data = await fetchWebhookSignal(WEBHOOK_SUBIR_SIIGO, payload);
  row.siigo_subido = checked;
  return data;
};

const enqueueSwitchUpdate = (row, checked) => {
  state.switchQueueCount += 1;
  const position = state.switchQueueCount;

  const task = async () => {
    setStatus(`Procesando factura ${format(row.numero_factura)} (${position} en cola)...`);

    try {
      const data = await runSwitchUpdate(row, checked);
      await wait(SWITCH_DELAY_MS);
      return data;
    } finally {
      state.switchQueueCount = Math.max(0, state.switchQueueCount - 1);
    }
  };

  state.switchQueue = state.switchQueue
    .catch(() => null)
    .then(task);

  return state.switchQueue;
};

const renderTable = () => {
  const canToggleSiigo = state.panelMode === "listas";
  const headers = ["subir_siigo", ...state.generalColumns];
  head.innerHTML = `<tr>${headers.map((col) => {
    if (col === "subir_siigo") return '<th class="siigo-control-col">Siigo</th>';
    const className = col === "fecha_iso" ? " class=\"fecha-col\"" : "";
    return `<th data-column="${col}"${className}>${toReadableLabel(col)}</th>`;
  }).join("")}</tr>`;

  body.innerHTML = "";
  const rows = getPaginatedRows();

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.classList.add("invoice-row");
    tr.classList.toggle("selected", row.__id === state.selectedId);

    const isUploaded = getInvoiceState(row);
    const hasSyncError = Boolean(state.switchErrorByInvoice[row.__id]);
    const tdSwitch = document.createElement("td");
    tdSwitch.className = "siigo-control-col";
    tdSwitch.innerHTML = `
      <div class="siigo-switch-wrap">
        <label class="switch" data-switch-label>
          <input type="checkbox" ${isUploaded ? "checked" : ""} ${canToggleSiigo ? "" : "disabled"}>
          <span class="slider"></span>
        </label>
        <span class="siigo-state ${hasSyncError ? "is-error" : (isUploaded ? "is-on" : "is-off")}">${hasSyncError ? "Error al subir" : (isUploaded ? "Subida" : "Pendiente")}</span>
      </div>
    `;

    const executeToggle = async (checked, inputEl = null) => {
      const rowAction = checked ? "subir" : "retirar";
      const previousChecked = getInvoiceState(row);
      if (inputEl) inputEl.disabled = true;
      setStatus(`Enviando señal para ${rowAction} factura ${format(row.numero_factura)} a ${WEBHOOK_SUBIR_SIIGO}...`);

      try {
        const data = await enqueueSwitchUpdate(row, checked);
        const okResult = typeof data?.ok === "boolean" ? data.ok : checked;

        if (checked && !okResult) {
          row.siigo_subido = false;
          state.switchErrorByInvoice[row.__id] = true;
          if (inputEl) {
            inputEl.checked = false;
            inputEl.closest(".switch")?.classList.add("siigo-switch-failed");
            setTimeout(() => inputEl.closest(".switch")?.classList.remove("siigo-switch-failed"), 460);
          }
          setStatus(data?.message || "Error al subir factura, revisa tus proveedores y recuerda tener creado el item matriz.");
          await wait(460);
          return;
        }

        row.siigo_subido = Boolean(checked);
        delete state.switchErrorByInvoice[row.__id];
        setStatus(data?.message || (checked
          ? `Factura ${format(row.numero_factura)} subida en Siigo.`
          : `Factura ${format(row.numero_factura)} retirada de Siigo.`));
      } catch {
        row.siigo_subido = previousChecked;
        if (inputEl) {
          inputEl.checked = previousChecked;
          if (checked) {
            state.switchErrorByInvoice[row.__id] = true;
            inputEl.closest(".switch")?.classList.add("siigo-switch-failed");
            setTimeout(() => inputEl.closest(".switch")?.classList.remove("siigo-switch-failed"), 460);
            await wait(460);
          }
        }
        setStatus(checked
          ? "Error al subir factura, revisa tus proveedores y recuerda tener creado el item matriz."
          : `Error al enviar la señal de ${rowAction} para la factura ${format(row.numero_factura)}.`);
      } finally {
        if (inputEl) inputEl.disabled = false;
        renderTable();
      }
    };

    tdSwitch.addEventListener("click", (event) => event.stopPropagation());
    tdSwitch.querySelector("[data-switch-label]")?.addEventListener("click", (event) => event.stopPropagation());

    const switchInput = tdSwitch.querySelector("input");
    switchInput?.addEventListener("change", async (event) => {
      if (!canToggleSiigo) return;
      event.stopPropagation();
      const nextChecked = event.target.checked;
      const currentChecked = getInvoiceState(row);
      if (currentChecked && !nextChecked) {
        const accepted = await requestDeactivateConfirmation();
        if (!accepted) {
          event.target.checked = true;
          return;
        }
      }
      await executeToggle(nextChecked, event.target);
    });

    tr.appendChild(tdSwitch);

    state.generalColumns.forEach((col) => {
      const td = document.createElement("td");
      const formatted = format(row[col]);
      const shouldExpand = typeof formatted === "string" && formatted.length > 36;
      if (shouldExpand) td.appendChild(createExpandableCellContent(formatted));
      else td.textContent = formatted;
      if (col === "fecha_iso") td.classList.add("fecha-col");
      tr.appendChild(td);
    });

    tr.addEventListener("click", () => {
      state.selectedId = row.__id;
      renderTable();
      updateDetailStatusText();
    });

    body.appendChild(tr);

    if (row.__id === state.selectedId) {
      body.appendChild(createDetailInlineRow(row));
    }
  });

  bindColumnDrag();
  bindInlineDetailDrag();
  renderPagination();
};

const getFuzzyScore = (query, candidate, threshold, matcher = similarityScore) => {
  if (!query) return 1;
  const score = matcher(query, candidate);
  return score >= threshold ? score : 0;
};

const applyFilters = () => {
  const sourceRows = getRowsByMode();
  const desde = filtroFechaDesde.value;
  const hasta = filtroFechaHasta.value;
  const numero = filtroNumero.value.trim();
  const proveedor = filtroProveedor.value.trim().toLowerCase();
  const nit = filtroNit.value.trim();

  const scoredRows = sourceRows.map((row) => {
    const fecha = String(row.fecha_iso || "");
    if (desde && fecha < desde) return null;
    if (hasta && fecha > hasta) return null;
    if (proveedor && !String(row.proveedor || "").toLowerCase().includes(proveedor)) return null;

    const numeroScore = getFuzzyScore(numero, row.numero_factura, FUZZY_THRESHOLD_NUMERO, invoiceSimilarityScore);
    const nitScore = getFuzzyScore(nit, row.nit, FUZZY_THRESHOLD_NIT);

    if (numero && numeroScore === 0) return null;
    if (nit && nitScore === 0) return null;

    return {
      row,
      rank: (numero ? numeroScore : 0) + (nit ? nitScore : 0)
    };
  }).filter(Boolean);

  const shouldSortBySimilarity = Boolean(numero || nit);
  if (shouldSortBySimilarity) {
    scoredRows.sort((a, b) => b.rank - a.rank);
  }

  state.filteredRows = scoredRows.map((item) => item.row);

  if (!state.filteredRows.find((row) => row.__id === state.selectedId)) {
    state.selectedId = state.filteredRows[0]?.__id || null;
  }

  state.currentPage = 1;
  renderTable();
  updateDetailStatusText();
};

const switchPanelMode = (mode) => {
  state.panelMode = mode;
  if (mode !== "revision") {
    state.correctionMode = null;
    state.correctionTargetId = null;
    if (nombreCuentaContable) nombreCuentaContable.value = "";
  }
  state.currentPage = 1;
  state.selectedId = null;
  renderPanelIndicators();
  applyFilters();
};

const downloadFile = (content, filename, mimeType) => {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
};

const buildExportRows = (rows) => rows.map((row) => ({
  numero_factura: row.numero_factura,
  prefijo_factura: row.prefijo_factura,
  consecutivo_factura: row.consecutivo_factura,
  fecha_iso: row.fecha_iso,
  proveedor: row.proveedor,
  nit: row.nit,
  direccion: row.direccion,
  telefono: row.telefono,
  correo_empresa: row.correo_empresa,
  estado: row.estado,
  tipo_factura: row.tipo_factura,
  debitos: row.debitos,
  creditos: row.creditos,
  balance: row.balance,
  total_items: row.total_items,
  siigo_subido: row.siigo_subido ? "true" : "false"
}));

const buildUnifiedRows = (rows) => {
  const invoiceRows = buildExportRows(rows);
  return rows.flatMap((row, index) => {
    const invoiceData = invoiceRows[index];
    const details = getDetailsByInvoice(row);
    if (!details.length) {
      return [{ ...invoiceData }];
    }

    return details.map((item) => ({
      ...invoiceData,
      detalle_producto: item.producto,
      detalle_cantidad: item.cantidad,
      detalle_valor_unitario: item.valor_unitario,
      detalle_subtotal: item.subtotal,
      detalle_valor_impuesto: item.valor_impuesto,
      detalle_codigo_contable: item.codigo_contable,
      detalle_valor_debito: item.valor_debito,
      detalle_valor_credito: item.valor_credito
    }));
  });
};

const exportCsv = (rows) => {
  const mapped = buildUnifiedRows(rows);
  if (!mapped.length) return setStatus("No hay facturas para descargar.");
  const headers = Object.keys(mapped[0]);
  const lines = [headers.join(",")];
  mapped.forEach((row) => {
    lines.push(headers.map((key) => escapeCsv(row[key])).join(","));
  });
  downloadFile(lines.join("\n"), `facturas_siigo_${Date.now()}.csv`, "text/csv;charset=utf-8;");
};

const exportExcelUnified = (rows) => {
  const mapped = buildUnifiedRows(rows);
  if (!mapped.length) return setStatus("No hay facturas para descargar.");
  const headers = Object.keys(mapped[0]);
  const bodyRows = mapped
    .map((row) => `<tr>${headers.map((key) => `<td>${format(row[key])}</td>`).join("")}</tr>`)
    .join("");

  const html = `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${bodyRows}</tbody></table>`;
  downloadFile(html, `facturas_siigo_unificadas_${Date.now()}.xls`, "application/vnd.ms-excel;charset=utf-8;");
};

const exportExcelSeparated = (rows) => {
  if (!rows.length) return setStatus("No hay facturas para descargar.");

  const generalHeaders = Object.keys(buildExportRows(rows)[0] || {});
  const detailHeaders = state.detailColumns;

  const blocks = rows.map((row, index) => {
    const general = buildExportRows([row])[0];
    const details = getDetailsByInvoice(row);
    const spacerCols = "<td></td><td></td>";

    const generalHeader = `<tr>${spacerCols}${generalHeaders.map((h) => `<th>${h}</th>`).join("")}</tr>`;
    const generalValues = `<tr>${spacerCols}${generalHeaders.map((h) => `<td>${format(general[h])}</td>`).join("")}</tr>`;

    const detailHeader = `<tr>${spacerCols}${detailHeaders.map((h) => `<th>${h}</th>`).join("")}</tr>`;
    const detailRows = details.length
      ? details.map((item) => `<tr>${spacerCols}${detailHeaders.map((h) => `<td>${format(item[h])}</td>`).join("")}</tr>`).join("")
      : `<tr>${spacerCols}<td colspan="${detailHeaders.length}">Sin items.</td></tr>`;

    return `
      <tr>${spacerCols}<td colspan="${Math.max(generalHeaders.length, detailHeaders.length)}"><strong>Factura ${index + 1}: ${format(row.numero_factura)}</strong></td></tr>
      ${generalHeader}
      ${generalValues}
      <tr><td></td><td></td></tr>
      ${detailHeader}
      ${detailRows}
      <tr><td></td><td></td></tr>
      <tr><td></td><td></td></tr>
    `;
  }).join("");

  const html = `<table>${blocks}</table>`;
  downloadFile(html, `facturas_siigo_cuadros_${Date.now()}.xls`, "application/vnd.ms-excel;charset=utf-8;");
};

const handleDownload = () => {
  const mode = modoDescarga?.value || "excel_unificada_filtradas";
  const rows = state.filteredRows;
  if (!rows.length) return setStatus("No hay facturas para descargar con este modo.");

  if (mode === "csv_filtradas") exportCsv(rows);
  else if (mode === "excel_cuadros_filtradas") exportExcelSeparated(rows);
  else exportExcelUnified(rows);

  setStatus(`Descarga generada (${rows.length} factura(s)).`);
};

const handleBulkLoad = async () => {
  const pendingRows = state.filteredRows.filter((row) => !row.siigo_subido);
  if (!pendingRows.length) {
    setStatus("Todas las facturas filtradas ya están cargadas en Siigo.");
    return;
  }

  setStatus(`Encolando ${pendingRows.length} factura(s) para cargar en Siigo...`);

  btnCargarTodasFacturas.disabled = true;

  try {
    for (const row of pendingRows) {
      // cola secuencial de 1 segundo por factura
      // eslint-disable-next-line no-await-in-loop
      await enqueueSwitchUpdate(row, true).catch(() => null);
    }

    renderTable();
    setStatus(`Carga masiva finalizada. Facturas procesadas: ${pendingRows.length}.`);
  } finally {
    btnCargarTodasFacturas.disabled = false;
  }

  renderTable();
  setStatus(`Carga masiva finalizada. Facturas procesadas: ${pendingRows.length}.`);
};

const getSelectedInvoice = () => state.allRows.find((row) => row.__id === state.selectedId) || null;

const buildCorreccionRows = (invoice) => {
  const items = Array.isArray(invoice?.items) ? invoice.items : [];
  return items
    .filter((item) => item.source === "inconveniente")
    .map((item) => ({
      id: item.id_unico,
      uuid_factura: invoice.factura_uuid,
      proveedor: invoice.proveedor,
      producto: item.producto,
      codigo_contable_original: item.codigo_contable_original || "",
      codigo_contable_corregido: String(item.codigo_contable || "").trim()
    }))
    .filter((item) => item.codigo_contable_corregido.length > 0)
    .filter((item) => item.codigo_contable_corregido !== item.codigo_contable_original)
    .filter((item) => /^\d{8}$/.test(item.codigo_contable_corregido));
};

const isPositiveWebhookResponse = (response) => {
  if (response === true) return true;
  if (typeof response === "object" && response !== null) {
    if (response.ok === true || response.success === true) return true;
    if (String(response.status || "").toLowerCase() === "true") return true;
  }
  return false;
};

const enviarCorreccionInconveniente = async (modo) => {
  const invoice = getSelectedInvoice();
  if (!invoice || state.panelMode !== "revision") {
    setStatus("Selecciona una factura del panel de revisión.");
    return;
  }

  if (state.correctionMode !== modo || state.correctionTargetId !== invoice.__id) {
    state.correctionMode = modo;
    state.correctionTargetId = invoice.__id;
    renderPanelIndicators();
    renderTable();
    const label = modo === "corregir_y_registrar_proveedor"
      ? "Edita el código contable y completa el nombre de la cuenta contable para registrar proveedor."
      : "Edita el código contable y vuelve a pulsar el botón para enviar.";
    setStatus(label);
    return;
  }

  if (modo === "corregir_y_registrar_proveedor") {
    const cuenta = String(nombreCuentaContable?.value || "").trim();
    if (!cuenta) {
      setStatus("Ingresa el nombre de la cuenta contable para registrar proveedor.");
      return;
    }
  }

  const rows = buildCorreccionRows(invoice);
  if (!rows.length) {
    setStatus("Debes cambiar al menos un código contable con formato válido de 8 dígitos.");
    return;
  }

  const payload = {
    tenant_id: state.context?.empresa_id,
    empresa_id: state.context?.empresa_id,
    usuario_id: getResponsableId(),
    rol: state.context?.rol,
    timestamp: getTimestamp(),
    accion: "corregir_inconveniente_factura",
    tipo_correccion: modo,
    uuid_factura: invoice.factura_uuid,
    numero_factura: invoice.numero_factura,
    proveedor: invoice.proveedor,
    nombre_cuenta_contable: modo === "corregir_y_registrar_proveedor"
      ? String(nombreCuentaContable?.value || "").trim().toUpperCase()
      : null,
    rows
  };

  try {
    const response = await fetchWebhookWithFallback(WEBHOOK_CORREGIR_FACTURA_INCONVENIENTE, payload);
    const ok = isPositiveWebhookResponse(response);
    if (!ok) {
      setStatus(response?.message || "No se pudo registrar la corrección.");
      return;
    }

    state.reviewRows = state.reviewRows.filter((row) => row.__id !== invoice.__id);
    state.correctedRows = [{ ...invoice, estado_revision: "corregida" }, ...state.correctedRows];
    state.allRows = [...state.readyRows, ...state.reviewRows, ...state.correctedRows];
    state.correctionMode = null;
    state.correctionTargetId = null;
    if (nombreCuentaContable) nombreCuentaContable.value = "";
    switchPanelMode("corregidas");
    setStatus(response?.message || "Corrección aplicada y factura movida a corregidas.");
  } catch (error) {
    setStatus(`Error aplicando corrección: ${error?.message || "sin detalle"}`);
  }
};

const loadFacturas = async () => {
  setStatus("Consultando facturas...");
  let rows = [];
  try {
    const generales = await fetchFacturasGenerales();
    const uuids = [...new Set(generales.map((row) => row.UUID).filter(Boolean))];
    const detalles = await fetchFacturasDetalles(uuids);
    const inconvenientesPendientes = await fetchFacturasInconvenientes(false);
    const inconvenientesResueltos = await fetchFacturasInconvenientes(true);
    const detailsByUuid = detalles.reduce((acc, item) => {
      const key = String(item.uuid_factura || "").trim();
      if (!key) return acc;
      if (!acc.has(key)) acc.set(key, []);
      acc.get(key).push(item);
      return acc;
    }, new Map());

    const pendingByUuid = inconvenientesPendientes.reduce((acc, item) => {
      const key = String(item.uuid_factura || "").trim();
      if (!key) return acc;
      if (!acc.has(key)) acc.set(key, []);
      acc.get(key).push(item);
      return acc;
    }, new Map());

    const resolvedByUuid = inconvenientesResueltos.reduce((acc, item) => {
      const key = String(item.uuid_factura || "").trim();
      if (!key) return acc;
      if (!acc.has(key)) acc.set(key, []);
      acc.get(key).push(item);
      return acc;
    }, new Map());

    rows = generales.map((row, idx) => {
      const uuid = String(row.UUID || "").trim();
      const hasPending = pendingByUuid.has(uuid);
      const hasResolved = resolvedByUuid.has(uuid);
      const invoice = normalizeInvoiceGeneral(
        row,
        detailsByUuid.get(uuid) || [],
        pendingByUuid.get(uuid) || [],
        hasPending ? "revision" : (hasResolved ? "corregida" : "lista")
      );
      return {
        ...invoice,
        __id: invoiceId(invoice, idx)
      };
    });
  } catch (primaryError) {
    console.warn("Carga principal de facturas falló. Activando fallback webhook.", primaryError);
    rows = await loadFacturasFromWebhookFallback();
    setStatus("Facturas cargadas con ruta de emergencia (webhook).");
  }

  state.readyRows = rows.filter((row) => row.estado_revision === "lista");
  state.reviewRows = rows.filter((row) => row.estado_revision === "revision");
  state.correctedRows = rows.filter((row) => row.estado_revision === "corregida");
  state.allRows = [...state.readyRows, ...state.reviewRows, ...state.correctedRows];

  state.filteredRows = getRowsByMode();
  state.selectedId = state.filteredRows[0]?.__id || null;
  state.currentPage = 1;

  renderPanelIndicators();
  renderTable();
  updateDetailStatusText();
  setStatus(rows.length
    ? `Facturas cargadas: ${rows.length}. Listas: ${state.readyRows.length}, revisión: ${state.reviewRows.length}, corregidas: ${state.correctedRows.length}.`
    : "No hay facturas para mostrar.");
};

const init = async () => {
  if (!WEBHOOK_SUBIR_SIIGO) {
    setStatus("Falta configurar el webhook de subida a Siigo.");
    return;
  }

  state.context = await getUserContext();
  if (!state.context) {
    setStatus("No se pudo validar la sesión.");
    return;
  }

  state.detailOrderByInvoice = safeParseJson(localStorage.getItem(DETAILS_ORDER_KEY) || "{}", {});

  try {
    await loadFacturas();
  } catch (error) {
    console.error("Error cargando facturas:", error);
    setStatus(`Error cargando facturas: ${error?.message || "detalle no disponible"}`);
  }
};

btnAplicarFiltros.addEventListener("click", applyFilters);
btnLimpiarFiltros.addEventListener("click", () => {
  [filtroFechaDesde, filtroFechaHasta, filtroNumero, filtroProveedor, filtroNit].forEach((el) => {
    el.value = "";
  });
  applyFilters();
});
btnDescargarFacturas?.addEventListener("click", handleDownload);
btnCargarTodasFacturas?.addEventListener("click", handleBulkLoad);
tabFacturasListas?.addEventListener("click", () => switchPanelMode("listas"));
tabFacturasRevision?.addEventListener("click", () => switchPanelMode("revision"));
tabFacturasCorregidas?.addEventListener("click", () => switchPanelMode("corregidas"));
corregirFacturaActualBtn?.addEventListener("click", () => enviarCorreccionInconveniente("corregir_factura_actual"));
corregirRegistrarProveedorBtn?.addEventListener("click", () => enviarCorreccionInconveniente("corregir_y_registrar_proveedor"));
body?.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const key = target.dataset.codigoEdit;
  if (!key) return;
  const invoice = getSelectedInvoice();
  if (!invoice) return;
  const item = (invoice.items || []).find((row) => String(row.id_unico) === String(key));
  if (!item) return;
  item.codigo_contable = target.value;
});

init();
