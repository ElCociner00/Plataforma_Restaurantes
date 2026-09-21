import {
  bootRappiShell, closeDialogOnBackdrop, emptyRow, escapeHtml, formatDate, formatMoney,
  getRappiContext, invokeRappi, isAdminContext, setBusy, statusBadge, toast,
} from "./core.js?v=20260914rappi6";
import { supabase } from "../supabase.js";
import { APP_URLS } from "../urls.js";

const BUCKET = "rappi-menu";
const state = { catalogo: null, productoEditado: null, grupoEditado: null, imagenPath: null };

const productDialog = document.querySelector("#product-dialog");
const groupDialog = document.querySelector("#group-dialog");
[productDialog, groupDialog].forEach((dialog) => {
  closeDialogOnBackdrop(dialog);
  dialog.querySelector("[data-close-dialog]").addEventListener("click", () => dialog.close());
});

try {
  await bootRappiShell();
  if (!isAdminContext()) {
    window.location.replace(APP_URLS.rappiOperacion);
  } else {
    wire();
    await cargar();
  }
} catch (error) {
  console.error("[rappi-menu]", error);
  toast(error.message || "No fue posible abrir el menú.", "error");
}

function wire() {
  document.querySelector("#refresh-menu").addEventListener("click", async (event) => {
    setBusy(event.currentTarget, true, "Actualizando…");
    try { await cargar(); } catch (error) { toast(error.message, "error"); }
    finally { setBusy(event.currentTarget, false); }
  });
  document.querySelector("#new-product").addEventListener("click", () => abrirProducto(null));
  document.querySelector("#new-group").addEventListener("click", () => abrirGrupo(null));
  document.querySelector("#product-form").addEventListener("submit", guardarProducto);
  document.querySelector("#group-form").addEventListener("submit", guardarGrupo);
  document.querySelector("#add-option").addEventListener("click", () => agregarFilaOpcion());
  document.querySelector("#publish-menu").addEventListener("click", publicar);
  document.querySelector("#product-image").addEventListener("change", previsualizarImagen);
}

async function cargar() {
  state.catalogo = await invokeRappi("rappi-menu", { action: "catalogo" });
  render();
}

function render() {
  const { productos, grupos, categorias, tiendas } = state.catalogo;
  const nombreCategoria = new Map(categorias.map((c) => [c.id, c.nombre]));
  const nombreGrupo = new Map(grupos.map((g) => [g.id, g.nombre]));

  document.querySelector("#products-count").textContent = productos.length
    ? `${productos.length} producto${productos.length === 1 ? "" : "s"} · ${productos.filter((p) => p.activo).length} a la venta en Rappi`
    : "Todavía no has creado productos.";

  document.querySelector("#products-body").innerHTML = productos.length
    ? productos.map((producto) => `<tr>
        <td>${producto.imagen_url ? `<img class="product-thumb" src="${escapeHtml(producto.imagen_url)}" alt="">` : `<span class="chip tone-warn">Sin foto</span>`}</td>
        <td><strong>${escapeHtml(producto.nombre)}</strong>${producto.descripcion ? `<br><span class="helper">${escapeHtml(producto.descripcion.slice(0, 90))}</span>` : ""}</td>
        <td>${escapeHtml(nombreCategoria.get(producto.categoria_id) || "Sin categoría")}</td>
        <td>${formatMoney(producto.precio)}</td>
        <td>${producto.grupos.length ? producto.grupos.map((id) => `<span class="chip">${escapeHtml(nombreGrupo.get(id) || "")}</span>`).join(" ") : `<span class="helper">Ninguna</span>`}</td>
        <td>${producto.activo ? statusBadge("OK") : `<span class="chip tone-warn">Pausado</span>`}</td>
        <td><button class="button secondary compact" type="button" data-edit-product="${escapeHtml(producto.id)}">Editar</button>
            <button class="button secondary compact" type="button" data-delete-product="${escapeHtml(producto.id)}">Borrar</button></td>
      </tr>`).join("")
    : emptyRow(7, "Crea tu primer producto con «Nuevo producto».");

  document.querySelector("#groups-body").innerHTML = grupos.length
    ? grupos.map((grupo) => `<tr>
        <td><strong>${escapeHtml(grupo.nombre)}</strong></td>
        <td>${grupo.min_qty === 0 ? "Opcional" : `Mínimo ${grupo.min_qty}`} · máximo ${grupo.max_qty}</td>
        <td>${grupo.opciones.length ? grupo.opciones.map((o) => `<span class="chip">${escapeHtml(o.nombre)}${Number(o.precio) > 0 ? ` +${formatMoney(o.precio)}` : ""}</span>`).join(" ") : `<span class="helper">Sin opciones</span>`}</td>
        <td><button class="button secondary compact" type="button" data-edit-group="${escapeHtml(grupo.id)}">Editar</button>
            <button class="button secondary compact" type="button" data-delete-group="${escapeHtml(grupo.id)}">Borrar</button></td>
      </tr>`).join("")
    : emptyRow(4, "Sin grupos de opciones. Solo hacen falta si tus productos llevan toppings o tamaños.");

  const selector = document.querySelector("#publish-store");
  const elegida = selector.value;
  selector.innerHTML = tiendas.length
    ? tiendas.map((tienda) => `<option value="${escapeHtml(tienda.id)}">${escapeHtml(tienda.store_name || "Tienda Rappi")}</option>`).join("")
    : `<option value="">Conecta Rappi primero</option>`;
  if (tiendas.some((tienda) => tienda.id === elegida)) selector.value = elegida;
  mostrarEstadoPublicacion();

  document.querySelectorAll("[data-edit-product]").forEach((b) => b.addEventListener("click", () => abrirProducto(b.dataset.editProduct)));
  document.querySelectorAll("[data-delete-product]").forEach((b) => b.addEventListener("click", () => borrarProducto(b)));
  document.querySelectorAll("[data-edit-group]").forEach((b) => b.addEventListener("click", () => abrirGrupo(b.dataset.editGroup)));
  document.querySelectorAll("[data-delete-group]").forEach((b) => b.addEventListener("click", () => borrarGrupo(b)));
  document.querySelector("#publish-store").addEventListener("change", mostrarEstadoPublicacion);
}

function mostrarEstadoPublicacion() {
  const tienda = state.catalogo.tiendas.find((t) => t.id === document.querySelector("#publish-store").value);
  const caja = document.querySelector("#publish-state");
  if (!tienda) { caja.hidden = true; return; }
  const ultima = tienda.ultima_publicacion;
  caja.hidden = false;
  caja.classList.toggle("warning", !ultima);
  caja.innerHTML = ultima
    ? `Última publicación: ${escapeHtml(formatDate(ultima.received_at))} · ${ultima.item_count} productos · Estado en Rappi: ${statusBadge(tienda.menu_approval_status || ultima.approval_status || "PENDING")}`
    : "Esta tienda todavía no tiene menú publicado desde Enkrato.";
}

function abrirProducto(id) {
  const producto = id ? state.catalogo.productos.find((p) => p.id === id) : null;
  state.productoEditado = producto?.id ?? null;
  state.imagenPath = producto?.imagen_path ?? null;
  document.querySelector("#product-dialog-title").textContent = producto ? producto.nombre : "Nuevo producto";
  document.querySelector("#product-name").value = producto?.nombre ?? "";
  document.querySelector("#product-price").value = producto ? Number(producto.precio) : "";
  document.querySelector("#product-description").value = producto?.descripcion ?? "";
  document.querySelector("#product-new-category").value = "";
  document.querySelector("#product-active").checked = producto ? producto.activo : true;
  document.querySelector("#product-image").value = "";
  const preview = document.querySelector("#product-image-preview");
  preview.hidden = !producto?.imagen_url;
  preview.src = producto?.imagen_url ?? "";

  document.querySelector("#product-category").innerHTML = `<option value="">Sin categoría</option>${
    state.catalogo.categorias.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.nombre)}</option>`).join("")}`;
  document.querySelector("#product-category").value = producto?.categoria_id ?? "";
  document.querySelector("#product-groups").innerHTML = state.catalogo.grupos.length
    ? state.catalogo.grupos.map((grupo) => `<label class="switch"><input type="checkbox" value="${escapeHtml(grupo.id)}" ${producto?.grupos?.includes(grupo.id) ? "checked" : ""}><span>${escapeHtml(grupo.nombre)}</span></label>`).join("")
    : `<span class="helper">Todavía no has creado grupos de opciones.</span>`;
  productDialog.showModal();
}

function previsualizarImagen(event) {
  const archivo = event.currentTarget.files?.[0];
  const preview = document.querySelector("#product-image-preview");
  if (!archivo) { preview.hidden = true; return; }
  preview.src = URL.createObjectURL(archivo);
  preview.hidden = false;
}

/** La imagen va al bucket público: Rappi solo acepta una URL en el menú. */
async function subirImagen(archivo) {
  if (archivo.size > 3_000_000) throw new Error("La foto no puede pesar más de 3 MB.");
  const empresaId = getRappiContext().empresa_id;
  const extension = (archivo.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const ruta = `${empresaId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, archivo, { upsert: false, contentType: archivo.type });
  if (error) throw new Error(`No se pudo subir la foto: ${error.message}`);
  return ruta;
}

async function guardarProducto(event) {
  event.preventDefault();
  const boton = event.currentTarget.querySelector("button[type=submit]");
  setBusy(boton, true, "Guardando…");
  try {
    const nuevaCategoria = document.querySelector("#product-new-category").value.trim();
    let categoriaId = document.querySelector("#product-category").value;
    if (nuevaCategoria) {
      const creada = await invokeRappi("rappi-menu", { action: "guardar_categoria", nombre: nuevaCategoria, orden: state.catalogo.categorias.length });
      categoriaId = creada.id;
    }
    const archivo = document.querySelector("#product-image").files?.[0];
    if (archivo) state.imagenPath = await subirImagen(archivo);

    await invokeRappi("rappi-menu", {
      action: "guardar_producto",
      id: state.productoEditado,
      nombre: document.querySelector("#product-name").value.trim(),
      descripcion: document.querySelector("#product-description").value.trim(),
      precio: Number(document.querySelector("#product-price").value),
      categoria_id: categoriaId || null,
      imagen_path: state.imagenPath,
      activo: document.querySelector("#product-active").checked,
      grupos: [...document.querySelectorAll("#product-groups input:checked")].map((i) => i.value),
    });
    productDialog.close();
    toast("Producto guardado. Recuerda publicar para que Rappi lo vea.");
    await cargar();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(boton, false);
  }
}

async function borrarProducto(boton) {
  const producto = state.catalogo.productos.find((p) => p.id === boton.dataset.deleteProduct);
  if (!window.confirm(`¿Borrar "${producto?.nombre}"? Desaparecerá de Rappi en la próxima publicación.`)) return;
  setBusy(boton, true, "Borrando…");
  try {
    await invokeRappi("rappi-menu", { action: "borrar_producto", id: boton.dataset.deleteProduct });
    toast("Producto borrado.");
    await cargar();
  } catch (error) {
    toast(error.message, "error");
    setBusy(boton, false);
  }
}

function abrirGrupo(id) {
  const grupo = id ? state.catalogo.grupos.find((g) => g.id === id) : null;
  state.grupoEditado = grupo?.id ?? null;
  document.querySelector("#group-dialog-title").textContent = grupo ? grupo.nombre : "Nuevo grupo";
  document.querySelector("#group-name").value = grupo?.nombre ?? "";
  document.querySelector("#group-min").value = grupo?.min_qty ?? 0;
  document.querySelector("#group-max").value = grupo?.max_qty ?? 1;
  document.querySelector("#group-options").innerHTML = "";
  (grupo?.opciones ?? []).forEach((opcion) => agregarFilaOpcion(opcion));
  if (!grupo?.opciones?.length) agregarFilaOpcion();
  groupDialog.showModal();
}

function agregarFilaOpcion(opcion = null) {
  const fila = document.createElement("div");
  fila.className = "option-row";
  fila.innerHTML = `
    <input class="option-name" maxlength="80" placeholder="Nombre de la opción" value="${escapeHtml(opcion?.nombre ?? "")}">
    <input class="option-price" type="number" min="0" step="1" placeholder="Costo extra" value="${opcion ? Number(opcion.precio) : 0}">
    <button class="button secondary compact" type="button">Quitar</button>`;
  fila.dataset.optionId = opcion?.id ?? "";
  fila.querySelector("button").addEventListener("click", () => fila.remove());
  document.querySelector("#group-options").appendChild(fila);
}

async function guardarGrupo(event) {
  event.preventDefault();
  const boton = event.currentTarget.querySelector("button[type=submit]");
  setBusy(boton, true, "Guardando…");
  try {
    const opciones = [...document.querySelectorAll("#group-options .option-row")].map((fila) => ({
      id: fila.dataset.optionId || null,
      nombre: fila.querySelector(".option-name").value.trim(),
      precio: Number(fila.querySelector(".option-price").value || 0),
    })).filter((opcion) => opcion.nombre);
    if (!opciones.length) throw new Error("Agrega al menos una opción al grupo.");
    await invokeRappi("rappi-menu", {
      action: "guardar_grupo",
      id: state.grupoEditado,
      nombre: document.querySelector("#group-name").value.trim(),
      min_qty: Number(document.querySelector("#group-min").value || 0),
      max_qty: Number(document.querySelector("#group-max").value || 1),
      opciones,
    });
    groupDialog.close();
    toast("Grupo de opciones guardado.");
    await cargar();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(boton, false);
  }
}

async function borrarGrupo(boton) {
  if (!window.confirm("¿Borrar este grupo de opciones? Los productos que lo usan se quedarán sin él.")) return;
  setBusy(boton, true, "Borrando…");
  try {
    await invokeRappi("rappi-menu", { action: "borrar_grupo", id: boton.dataset.deleteGroup });
    toast("Grupo borrado.");
    await cargar();
  } catch (error) {
    toast(error.message, "error");
    setBusy(boton, false);
  }
}

async function publicar(event) {
  const boton = event.currentTarget;
  const storeId = document.querySelector("#publish-store").value;
  if (!storeId) return toast("Elige una tienda.", "error");
  const activos = state.catalogo.productos.filter((p) => p.activo);
  if (!activos.length) return toast("No hay productos activos para publicar.", "error");
  const sinFoto = activos.filter((p) => !p.imagen_path).length;
  const aviso = sinFoto ? `\n\n${sinFoto} producto(s) van sin foto y Rappi puede rechazarlos.` : "";
  if (!window.confirm(`Se publicarán ${activos.length} productos y reemplazarán la carta actual de esa tienda en Rappi.${aviso}\n\n¿Publicar?`)) return;
  setBusy(boton, true, "Publicando…");
  try {
    const resultado = await invokeRappi("rappi-menu", { action: "publicar", store_id: storeId, environment: "DEV" });
    toast(`Menú enviado a Rappi: ${resultado.publicados} productos. Rappi debe aprobarlo antes de mostrarlo.`);
    await cargar();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(boton, false);
  }
}
