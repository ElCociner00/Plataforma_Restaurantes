import { getUserContext } from "./session.js";
import {
  WEBHOOK_COMPRAS_CONSULTAR_INVENTARIOS,
  WEBHOOK_COMPRAS_SUBIR_MATCH
} from "./webhooks.js";

const btnConsultar = document.getElementById("consultarCompras");
const btnEnviar = document.getElementById("enviarCompras");
const statusEl = document.getElementById("comprasStatus");
const facturasWrap = document.getElementById("comprasFacturas");

let inventarios = [];
let facturas = [];

const setStatus = (msg) => { statusEl.textContent = msg; };

const normalizeList = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.data)) return raw.data;
  if (Array.isArray(raw?.[0]?.data)) return raw[0].data;
  return [];
};

const parseProductosFacturados = (rows) => {
  const byUuid = new Map();
  for (const row of rows) {
    const producto = String(row?.Producto || "").trim();
    if (!producto) continue;
    const upper = producto.toUpperCase();
    if (upper.includes("BANCOLOMBIA") || upper.includes("IMPUESTO")) continue;

    const uuid = String(row?.uuid || `${row["Prefijo Factura"] || ""}-${row["Consecutivo Factura"] || ""}`).trim();
    if (!uuid) continue;
    if (!byUuid.has(uuid)) {
      byUuid.set(uuid, {
        factura: {
          uuid,
          prefijo: row["Prefijo Factura"] || "",
          consecutivo: row["Consecutivo Factura"] || "",
          proveedor: row?.Proveedor || "",
          fecha: row["Fecha Factura"] || ""
        },
        items: []
      });
    }
    byUuid.get(uuid).items.push({
      producto,
      cantidadLlegada: Number(row?.Cantidad || 0)
    });
  }
  return Array.from(byUuid.values());
};

async function fetchInventarios(context) {
  const res = await fetch(WEBHOOK_COMPRAS_CONSULTAR_INVENTARIOS, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ empresa_id: context.empresa_id, tenant_id: context.empresa_id })
  });
  const data = await res.json();
  return normalizeList(data).filter((p) => p && p.id && p.nombre);
}

async function fetchFacturas(context) {
  const key = `compras_facturas_cache_${context.empresa_id}`;
  const cached = sessionStorage.getItem(key);
  if (!cached) return [];
  try {
    return normalizeList(JSON.parse(cached));
  } catch {
    return [];
  }
}

function render() {
  facturasWrap.innerHTML = "";
  if (!facturas.length) {
    facturasWrap.innerHTML = "<p>No hay facturas cargadas. Cárgalas al sessionStorage con la llave compras_facturas_cache_{empresa_id}.</p>";
    btnEnviar.disabled = true;
    return;
  }

  facturas.forEach((group, groupIndex) => {
    const card = document.createElement("article");
    card.className = "factura-card";
    const head = document.createElement("div");
    head.className = "factura-head";
    head.innerHTML = `<strong>${group.factura.prefijo} ${group.factura.consecutivo}</strong><span>${group.factura.proveedor}</span><span>${group.factura.fecha}</span>`;

    const table = document.createElement("table");
    table.className = "factura-table";
    table.innerHTML = "<thead><tr><th>Producto factura</th><th>Cantidad llegada</th><th>Producto inventario</th><th>Cantidad a cargar</th><th>Unidad</th></tr></thead>";
    const body = document.createElement("tbody");

    group.items.forEach((item, itemIndex) => {
      const row = document.createElement("tr");
      const options = ['<option value="">Seleccionar</option>'].concat(
        inventarios.map((p) => `<option value="${p.id}">${p.nombre}</option>`)
      ).join("");
      row.innerHTML = `
        <td>${item.producto}</td>
        <td>${item.cantidadLlegada}</td>
        <td><select data-g="${groupIndex}" data-i="${itemIndex}" class="sel-prod">${options}</select></td>
        <td><input type="number" min="0" step="0.01" data-g="${groupIndex}" data-i="${itemIndex}" class="inp-cantidad" value="${item.cantidadLlegada}"></td>
        <td class="unidad-cell">-</td>
      `;
      body.appendChild(row);
    });

    table.appendChild(body);
    const wrap = document.createElement("div");
    wrap.className = "factura-table-wrap";
    wrap.appendChild(table);

    card.appendChild(head);
    card.appendChild(wrap);
    facturasWrap.appendChild(card);
  });

  facturasWrap.querySelectorAll(".sel-prod").forEach((sel) => {
    sel.addEventListener("change", () => {
      const tr = sel.closest("tr");
      const producto = inventarios.find((p) => p.id === sel.value);
      tr.querySelector(".unidad-cell").textContent = producto?.unidad || "-";
    });
  });

  btnEnviar.disabled = false;
}

btnConsultar.addEventListener("click", async () => {
  setStatus("Consultando inventarios y facturas...");
  btnConsultar.disabled = true;
  try {
    const context = await getUserContext();
    if (!context?.empresa_id) throw new Error("Sin empresa activa.");

    inventarios = await fetchInventarios(context);
    const rawRows = await fetchFacturas(context);
    facturas = parseProductosFacturados(rawRows);
    render();
    setStatus(`Facturas: ${facturas.length}. Productos inventario: ${inventarios.length}.`);
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    btnConsultar.disabled = false;
  }
});

btnEnviar.addEventListener("click", async () => {
  const context = await getUserContext();
  if (!context?.empresa_id) return;

  const payloadItems = [];
  facturasWrap.querySelectorAll("tbody tr").forEach((tr) => {
    const select = tr.querySelector(".sel-prod");
    const cantidad = tr.querySelector(".inp-cantidad");
    if (!select.value) return;
    const inv = inventarios.find((p) => p.id === select.value);
    payloadItems.push({
      producto_factura: tr.children[0].textContent,
      cantidad_llegada: Number(tr.children[1].textContent || 0),
      producto_loggro_id: select.value,
      producto_loggro_nombre: inv?.nombre || "",
      cantidad_match: Number(cantidad.value || 0),
      unidad: inv?.unidad || ""
    });
  });

  if (!payloadItems.length) {
    setStatus("Debes seleccionar al menos un producto para enviar.");
    return;
  }

  setStatus("Enviando match de compras...");
  btnEnviar.disabled = true;
  try {
    const res = await fetch(WEBHOOK_COMPRAS_SUBIR_MATCH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresa_id: context.empresa_id, items: payloadItems })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setStatus("Match enviado correctamente.");
  } catch (error) {
    setStatus(`No se pudo enviar: ${error.message}`);
  } finally {
    btnEnviar.disabled = false;
  }
});
