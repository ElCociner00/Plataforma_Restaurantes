import { enforceNumericInput } from "../js/input_utils.js";
import { getUserContext } from "../js/session.js";
import {
  WEBHOOK_CIERRE_INVENTARIOS_CARGAR_PRODUCTOS,
  WEBHOOK_CIERRE_INVENTARIOS_CONSULTAR,
  WEBHOOK_CIERRE_INVENTARIOS_VERIFICAR,
  WEBHOOK_CIERRE_INVENTARIOS_SUBIR,
  WEBHOOK_LISTAR_RESPONSABLES
} from "../js/webhooks.js";

const fecha = document.getElementById("fecha");
const responsable = document.getElementById("responsable");
const horaInicio = document.getElementById("hora_inicio");
const horaFin = document.getElementById("hora_fin");
const inventarioBody = document.getElementById("inventarioBody");
const status = document.getElementById("status");

const btnConsultar = document.getElementById("consultar");
const btnVerificar = document.getElementById("verificar");
const btnSubir = document.getElementById("subir");
const btnLimpiar = document.getElementById("limpiar");

const setStatus = (message) => {
  status.textContent = message;
};

const getContextPayload = async () => {
  const context = await getUserContext();
  if (!context) return null;
  return {
    tenant_id: context.empresa_id,
    empresa_id: context.empresa_id,
    usuario_id: context.user?.id || context.user?.user_id,
    rol: context.rol
  };
};

const normalizeList = (raw, keys = []) => {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    if (!raw.length) return [];

    for (const key of keys) {
      const nested = raw.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        if (Array.isArray(item[key])) return item[key];
        if (item[key] && typeof item[key] === "object") {
          return Object.entries(item[key]).map(([id, value]) => ({
            id,
            ...(typeof value === "object" ? value : { value })
          }));
        }
        return [];
      });
      if (nested.length) return nested;
    }

    return raw;
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
  }

  return Object.entries(raw)
    .filter(([id]) => id !== "ok" && id !== "message")
    .map(([id, item]) => ({
      id,
      ...(typeof item === "object" ? item : { value: item })
    }));
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

const setButtonState = ({ consultar, verificar, subir }) => {
  if (typeof consultar === "boolean") btnConsultar.disabled = !consultar;
  if (typeof verificar === "boolean") btnVerificar.disabled = !verificar;
  if (typeof subir === "boolean") btnSubir.disabled = !subir;
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
    const res = await fetch(WEBHOOK_LISTAR_RESPONSABLES, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(contextPayload)
    });

    const data = await res.json();
    const responsables = normalizeList(data, ["responsables"]);

    responsable.innerHTML = '<option value="">Seleccione responsable</option>';
    responsables.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id ?? item.value ?? item.nombre ?? item.name ?? "";
      option.textContent = item.nombre ?? item.name ?? item.label ?? option.value;
      responsable.appendChild(option);
    });
  } catch (error) {
    setStatus("No se pudieron cargar responsables.");
  }
};

// 1. FUNCIÓN PARA OBTENER Y FILTRAR PRODUCTOS
const obtenerProductosVisibles = async () => {
  const contextPayload = await getContextPayload();
  if (!contextPayload) {
    return { productosVisibles: [], totalProductos: 0 };
  }

  try {
    // Obtener productos del webhook
    const res = await fetch(WEBHOOK_CIERRE_INVENTARIOS_CARGAR_PRODUCTOS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(contextPayload)
    });
    
    const data = await res.json();
    
    // Usar EXACTAMENTE el mismo método que funciona en visualizacion
    const productos = normalizeList(data, ["productos", "items"]);
    
    // Obtener configuración de visibilidad
    const visibilidad = getVisibilitySettings(contextPayload.tenant_id);
    
    // Filtrar productos por visibilidad
    const productosVisibles = [];
    const productosOcultos = [];
    
    productos.forEach((item) => {
      const productId = String(item.id ?? item.producto_id ?? item.codigo ?? "");
      if (!productId) return;
      
      const nombre = item.nombre ?? item.name ?? item.descripcion ?? `Producto ${productId}`;
      const productoCompleto = { ...item, productId, nombre };
      
      // Verificar si hay configuración de visibilidad
      const tieneConfiguracion = Object.keys(visibilidad).length > 0;
      
      if (!tieneConfiguracion) {
        // Si NO hay configuración, mostrar TODOS por defecto
        productosVisibles.push(productoCompleto);
      } else {
        // Si HAY configuración, aplicar filtro
        const visible = visibilidad[productId] !== false;
        if (visible) {
          productosVisibles.push(productoCompleto);
        } else {
          productosOcultos.push(productoCompleto);
        }
      }
    });
    
    return {
      productosVisibles,
      totalProductos: productos.length,
      productosOcultos: productosOcultos.length
    };
    
  } catch (error) {
    console.error("Error obteniendo productos:", error);
    return { productosVisibles: [], totalProductos: 0, productosOcultos: 0, error: error.message };
  }
};

// 2. FUNCIÓN PARA RENDERIZAR PRODUCTOS VISIBLES
const renderProducts = async () => {
  const contextPayload = await getContextPayload();
  if (!contextPayload) {
    setStatus("No se pudo validar la sesión.");
    return;
  }

  setStatus("Cargando productos...");

  try {
    // 1. Llamar al webhook
    const res = await fetch(WEBHOOK_CIERRE_INVENTARIOS_CARGAR_PRODUCTOS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(contextPayload)
    });
    
    // 2. Obtener la respuesta
    const data = await res.json();
    console.log("DEBUG - Respuesta completa:", data);
    
    // 3. EXTRAER PRODUCTOS DE FORMA DIRECTA Y SIMPLE
    let productosArray = [];
    
    // Opción 1: Si viene como { ok: true, productos: [...] }
    if (data && data.ok && Array.isArray(data.productos)) {
      productosArray = data.productos;
    }
    // Opción 2: Si viene como [{ ok: true, productos: [...] }]
    else if (Array.isArray(data) && data.length > 0 && data[0].productos) {
      productosArray = data[0].productos;
    }
    // Opción 3: Si viene como array directo de productos
    else if (Array.isArray(data) && data.length > 0 && data[0].id) {
      productosArray = data;
    }
    // Opción 4: Usar la función normalizeList como última opción
    else {
      try {
        productosArray = normalizeList(data, ["productos", "items"]);
      } catch (error) {
        console.error("Error usando normalizeList:", error);
        productosArray = [];
      }
    }
    
    console.log("DEBUG - Productos extraídos:", productosArray);
    console.log("DEBUG - Es array?", Array.isArray(productosArray));
    console.log("DEBUG - Cantidad:", productosArray ? productosArray.length : 0);
    
    // Validar que tenemos un array
    if (!Array.isArray(productosArray)) {
      console.error("productosArray no es un array:", productosArray);
      setStatus("Error: Formato de productos no válido");
      return;
    }
    
    // 4. Obtener configuración de visibilidad
    const visibilidad = getVisibilitySettings(contextPayload.tenant_id);
    console.log("DEBUG - Configuración de visibilidad:", visibilidad);
    
    // 5. Limpiar tabla
    inventarioBody.innerHTML = "";
    productRows.clear();
    
    // 6. Determinar si mostrar todos por defecto
    const mostrarTodosPorDefecto = Object.keys(visibilidad).length === 0;
    
    let productosMostrados = 0;
    let productosOcultos = 0;
    
    // 7. Renderizar productos
    for (let i = 0; i < productosArray.length; i++) {
      const item = productosArray[i];
      
      // Extraer ID de forma segura
      const productId = item.id || item.producto_id || item.codigo || "";
      if (!productId) {
        console.log("DEBUG - Item sin ID:", item);
        continue;
      }
      
      // Extraer nombre de forma segura
      const nombre = item.nombre || item.name || item.descripcion || `Producto ${productId}`;
      
      // Determinar visibilidad
      let visible = true;
      if (!mostrarTodosPorDefecto) {
        visible = visibilidad[productId] !== false;
      }
      
      console.log(`DEBUG - Producto ${i}: ${nombre}, ID: ${productId}, Visible: ${visible}`);
      
      if (!visible) {
        productosOcultos++;
        continue;
      }
      
      // Crear fila de tabla
      const tr = document.createElement("tr");
      tr.dataset.productId = productId;
      tr.innerHTML = `
        <td>${nombre}</td>
        <td><input type="text" class="stock" readonly value="0"></td>
        <td><input type="text" class="stock-gastado" value=""></td>
        <td><input type="text" class="restante" readonly value="0"></td>
      `;
      inventarioBody.appendChild(tr);
      
      // Obtener referencias a inputs
      const stockInput = tr.querySelector(".stock");
      const gastadoInput = tr.querySelector(".stock-gastado");
      const restanteInput = tr.querySelector(".restante");
      
      // Configurar validación y eventos
      enforceNumericInput(gastadoInput);
      gastadoInput.addEventListener("input", resetVerification);
      
      // Guardar en mapa
      productRows.set(productId, {
        nombre,
        stockInput,
        gastadoInput,
        restanteInput,
        visible: true
      });
      
      productosMostrados++;
    }
    
    // 8. Actualizar estado
    if (productosArray.length === 0) {
      setStatus("No se recibieron productos del sistema.");
    } else if (productosMostrados === 0) {
      setStatus(`⚠️ Hay ${productosArray.length} productos pero todos están ocultos. Configura la visibilidad primero.`);
    } else {
      setStatus(`Cargados ${productosMostrados} productos${productosOcultos > 0 ? ` (${productosOcultos} ocultos)` : ''}`);
    }
    
  } catch (error) {
    console.error("ERROR COMPLETO:", error);
    setStatus("Error al cargar productos: " + error.message);
  }
};

// 3. FUNCIÓN PRINCIPAL QUE ORQUESTA EL PROCESO
const renderProducts = async () => {
  const contextPayload = await getContextPayload();
  if (!contextPayload) {
    setStatus("No se pudo validar la sesión.");
    return;
  }

  setStatus("Cargando productos...");

  try {
    // PASO 1: Obtener y filtrar productos
    const { productosVisibles, totalProductos, productosOcultos, error } = await obtenerProductosVisibles();
    
    if (error) {
      throw new Error(error);
    }
    
    // Debug en consola
    console.log("Total productos recibidos:", totalProductos);
    console.log("Productos visibles:", productosVisibles.length);
    console.log("Productos ocultos:", productosOcultos);
    console.log("Primer producto (si existe):", productosVisibles[0]);
    
    // PASO 2: Renderizar productos visibles
    const productosRenderizados = renderizarProductos(productosVisibles);
    
    // PASO 3: Actualizar estado
    if (totalProductos === 0) {
      setStatus("No se recibieron productos del sistema.");
    } else if (productosRenderizados === 0 && totalProductos > 0) {
      setStatus(`⚠️ Hay ${totalProductos} productos pero todos están ocultos. Ve a "Visualizar productos" para activarlos.`);
    } else {
      setStatus(`Cargados ${productosRenderizados} de ${totalProductos} productos. ${productosOcultos > 0 ? `(${productosOcultos} ocultos)` : ''}`);
    }
    
  } catch (error) {
    console.error("Error en renderProducts:", error);
    setStatus("Error al cargar productos: " + error.message);
  }
};

const validateRequiredFields = () => {
  if (!fecha.value || !responsable.value || !horaInicio.value || !horaFin.value) {
    setStatus("⚠️ Completa fecha, responsable y turno.");
    return false;
  }
  if (!productRows.size) {
    setStatus("⚠️ No hay productos cargados para operar.");
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

    const data = await res.json();
    const stocks = normalizeList(data, ["stocks", "productos", "items"]);

    stocks.forEach((item) => {
      const productId = String(item.producto_id ?? item.id ?? item.codigo ?? "");
      const row = productRows.get(productId);
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

btnVerificar.addEventListener("click", async () => {
  if (!validateRequiredFields()) return;

  const payload = await buildBasePayload();
  if (!payload) {
    setStatus("No se pudo validar la sesión.");
    return;
  }

  setStatus("Verificando restante...");

  try {
    const res = await fetch(WEBHOOK_CIERRE_INVENTARIOS_VERIFICAR, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        items: readRowsForWebhook()
      })
    });

    const data = await res.json();
    const restantes = normalizeList(data, ["restantes", "productos", "items"]);

    restantes.forEach((item) => {
      const productId = String(item.producto_id ?? item.id ?? item.codigo ?? "");
      const row = productRows.get(productId);
      if (!row) return;
      const restanteValue = item.restante ?? item.stock_restante ?? item.value ?? 0;
      row.restanteInput.value = String(restanteValue);
    });

    verified = data.ok !== false;
    setButtonState({ subir: verified });
    setStatus(verified ? "Verificación completada." : "Verificación reportó errores.");
  } catch (error) {
    setStatus("Error verificando restante.");
  }
});

btnSubir.addEventListener("click", async () => {
  if (!verified) {
    setStatus("⚠️ Primero debes verificar los datos.");
    return;
  }

  const payload = await buildBasePayload();
  if (!payload) {
    setStatus("No se pudo validar la sesión.");
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

    const data = await res.json();
    setStatus(data.message || (data.ok ? "Datos subidos correctamente." : "El webhook devolvió error."));
  } catch (error) {
    setStatus("Error subiendo datos.");
  }
});

btnLimpiar.addEventListener("click", () => {
  productRows.forEach((rowData) => {
    rowData.stockInput.value = "0";
    rowData.gastadoInput.value = "";
    rowData.restanteInput.value = "0";
  });
  resetVerification();
  setButtonState({ verificar: false });
  setStatus("Datos limpiados.");
});

[fecha, responsable, horaInicio, horaFin].forEach((element) => {
  element.addEventListener("change", resetVerification);
});

setButtonState({ consultar: true, verificar: false, subir: false });
loadResponsables();
renderProducts();
