import {
  bootRappiShell, closeDialogOnBackdrop, escapeHtml, formatDate, formatMoney,
  getRappiContext, invokeRappi, isAdminContext, setBusy, statusBadge, toast,
} from "./core.js?v=20260914rappi6";
import { supabase } from "../supabase.js";
import { APP_URLS } from "../urls.js";

const BUCKET = "rappi-menu";
const $ = (selector) => document.querySelector(selector);
const state = {
  catalogo: null, productoId: null, seccionId: null, imagenPath: null,
  tiendaId: null, sincronizando: false, aviso: "", allowLeave: false,
  seccionesAbiertas: new Set(), intentoSalida: null,
};
const productDialog = $("#product-dialog");
const sectionDialog = $("#section-dialog");
const leaveDialog = $("#leave-dialog");
for (const dialog of [productDialog, sectionDialog, leaveDialog]) {
  closeDialogOnBackdrop(dialog);
  dialog.querySelector("[data-close-dialog]")?.addEventListener("click", () => dialog.close());
}

try {
  await bootRappiShell();
  if (!isAdminContext()) window.location.replace(APP_URLS.rappiOperacion);
  else {
    wire();
    await cargar(true);
  }
} catch (error) {
  console.error("[rappi-menu]", error);
  toast(error.message || "No fue posible abrir el menú.", "error");
}

function wire() {
  $("#refresh-menu").addEventListener("click", async (event) => {
    setBusy(event.currentTarget, true, "Actualizando…");
    try { await cargar(true); } catch (error) { toast(error.message, "error"); }
    finally { setBusy(event.currentTarget, false); }
  });
  $("#new-section").addEventListener("click", () => abrirSeccion());
  $("#section-form").addEventListener("submit", guardarSeccion);
  $("#product-form").addEventListener("submit", guardarProducto);
  $("#add-question").addEventListener("click", () => agregarPregunta());
  $("#product-image").addEventListener("change", previsualizarImagen);
  $("#publish-menu").addEventListener("click", publicar);
  $("#publish-store").addEventListener("change", (event) => {
    state.tiendaId = event.target.value;
    mostrarEstado();
  });
  $("#menu-sections").addEventListener("click", accionListado);
  $("#product-questions").addEventListener("click", accionPregunta);
  $("#sync-banner").addEventListener("click", async (event) => {
    if (!event.target.closest("[data-discard-local]")) return;
    if (!window.confirm("Se descartarán los cambios locales y se reemplazará el menú por el que Rappi devuelve. ¿Continuar?")) return;
    try { await sincronizar(true); await cargar(false); }
    catch (error) { toast(error.message, "error"); }
  });
  $("#leave-publish").addEventListener("click", async () => {
    leaveDialog.close();
    await publicar();
    if (!hayCambios()) seguirSalida();
  });
  $("#leave-anyway").addEventListener("click", () => { leaveDialog.close(); seguirSalida(); });
  $("#leave-cancel").addEventListener("click", () => { state.intentoSalida = null; leaveDialog.close(); });
  window.addEventListener("beforeunload", (event) => {
    if (hayCambios() && !state.allowLeave) { event.preventDefault(); event.returnValue = ""; }
  });
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link || !hayCambios() || state.allowLeave || link.target === "_blank") return;
    const destino = new URL(link.href, location.href);
    if (destino.origin !== location.origin || destino.href === location.href) return;
    event.preventDefault();
    state.intentoSalida = destino.href;
    leaveDialog.showModal();
  }, true);
}

async function cargar(traerDeRappi = false) {
  state.catalogo = await invokeRappi("rappi-menu", { action: "catalogo" });
  state.tiendaId = state.catalogo.tiendas.some((t) => t.id === state.tiendaId)
    ? state.tiendaId : state.catalogo.tiendas[0]?.id || null;
  if (traerDeRappi && state.tiendaId) {
    try {
      await sincronizar(false);
      state.catalogo = await invokeRappi("rappi-menu", { action: "catalogo" });
    } catch (error) {
      state.aviso = `No se pudo comprobar la carta de Rappi: ${error.message}`;
    }
  }
  render();
}

async function sincronizar(descartar) {
  if (state.sincronizando || !state.tiendaId) return;
  state.sincronizando = true;
  state.aviso = "";
  mostrarEstado();
  try {
    const resultado = await invokeRappi("rappi-menu", {
      action: "sincronizar", store_id: state.tiendaId, environment: "DEV",
      descartar_cambios: descartar,
    });
    if (resultado?.estado === "cambios_locales") {
      state.aviso = "Tienes cambios sin publicar. Publícalos para que Rappi los muestre, o descártalos y vuelve a traer el menú.";
    } else if (resultado?.estado === "sincronizado") {
      state.aviso = "";
    }
    return resultado;
  } finally {
    state.sincronizando = false;
    mostrarEstado();
  }
}

function tiendaActual() {
  return state.catalogo?.tiendas.find((t) => t.id === state.tiendaId);
}
function hayCambios() {
  const tienda = tiendaActual();
  const estado = tienda?.estado_menu;
  if (!estado) return Boolean(state.catalogo?.productos.length);
  if (estado.hash_pendiente && estado.hash_local === estado.hash_pendiente) return false;
  return estado.hash_local !== estado.hash_publicado;
}
function mostrarEstado() {
  const tienda = tiendaActual();
  const estado = tienda?.estado_menu;
  const pendiente = estado?.approval_status === "PENDING";
  const sucio = hayCambios();
  const texto = state.sincronizando ? "Comprobando el menú de Rappi…"
    : sucio ? "Cambios sin publicar"
    : pendiente ? "En revisión por Rappi"
    : estado ? "Sincronizado con el último menú recibido de Rappi"
    : "Todavía no se ha sincronizado el menú";
  $("#sync-banner").className = `notice menu-sync ${sucio ? "warning" : pendiente ? "menu-sync-pending" : "menu-sync-ok"}`;
  $("#sync-banner").innerHTML = `<strong>${escapeHtml(texto)}</strong>${state.aviso ? `<p>${escapeHtml(state.aviso)}</p>` : ""}
    ${sucio ? '<button class="button secondary compact" type="button" data-discard-local>Descartar cambios y traer de Rappi</button>' : ""}`;
  const ultima = tienda?.ultima_publicacion;
  $("#publish-state").hidden = !tienda;
  $("#publish-state").innerHTML = ultima
    ? `Último envío: ${escapeHtml(formatDate(ultima.received_at))} · ${Number(ultima.item_count)} productos · ${statusBadge(tienda.menu_approval_status || ultima.approval_status || "PENDING")}`
    : "Esta tienda todavía no tiene un envío registrado desde Enkrato.";
}

function render() {
  const { productos, categorias, tiendas } = state.catalogo;
  $("#products-count").textContent = `${categorias.length} secciones · ${productos.length} productos · ${productos.filter((p) => p.activo).length} a la venta`;
  const selector = $("#publish-store");
  selector.innerHTML = tiendas.length
    ? tiendas.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.store_name || "Tienda Rappi")}</option>`).join("")
    : '<option value="">Conecta Rappi primero</option>';
  selector.value = state.tiendaId || "";
  $("#publish-menu").disabled = !state.tiendaId;
  mostrarEstado();
  const abiertasPorDefecto = categorias.length <= 3;
  $("#menu-sections").innerHTML = categorias.length
    ? categorias.map((categoria, index) => {
      const propios = productos.filter((p) => p.categoria_id === categoria.id)
        .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
      const abierta = state.seccionesAbiertas.has(categoria.id) || (abiertasPorDefecto && !state.seccionesAbiertas.has("cerrada:" + categoria.id));
      return `<section class="menu-section" data-section="${escapeHtml(categoria.id)}">
        <div class="menu-section-head">
          <button class="menu-section-toggle" type="button" data-toggle-section aria-expanded="${abierta}">
            <span aria-hidden="true">${abierta ? "▾" : "▸"}</span> ${escapeHtml(categoria.nombre)}
            <small>${propios.length} producto${propios.length === 1 ? "" : "s"}</small>
          </button>
          <div class="menu-section-actions">
            <button type="button" class="button secondary compact" data-move-section="-1" ${index === 0 ? "disabled" : ""} aria-label="Subir sección">↑</button>
            <button type="button" class="button secondary compact" data-move-section="1" ${index === categorias.length - 1 ? "disabled" : ""} aria-label="Bajar sección">↓</button>
            <button type="button" class="button secondary compact" data-edit-section>Editar</button>
            <button type="button" class="button secondary compact" data-delete-section>Borrar</button>
          </div>
        </div>
        <div class="menu-section-body" ${abierta ? "" : "hidden"}>
          ${propios.map((p, pos) => `<article class="menu-product" data-product="${escapeHtml(p.id)}">
            <div class="menu-product-image">${p.imagen_url ? `<img src="${escapeHtml(p.imagen_url)}" alt="">` : '<span>Sin foto</span>'}</div>
            <div class="menu-product-title"><strong>${escapeHtml(p.nombre)}</strong><small>${p.grupos.length} pregunta${p.grupos.length === 1 ? "" : "s"} · ${p.activo ? "A la venta" : "Pausado"}</small></div>
            <strong>${formatMoney(p.precio)}</strong>
            <div class="menu-product-actions">
              <button type="button" class="button secondary compact" data-move-product="-1" ${pos === 0 ? "disabled" : ""} aria-label="Subir producto">↑</button>
              <button type="button" class="button secondary compact" data-move-product="1" ${pos === propios.length - 1 ? "disabled" : ""} aria-label="Bajar producto">↓</button>
              <button type="button" class="button secondary compact" data-edit-product>Editar</button>
              <button type="button" class="button secondary compact" data-delete-product>Borrar</button>
            </div>
          </article>`).join("")}
          <button class="button secondary compact menu-add-product" type="button" data-add-product>Añadir producto a esta sección</button>
        </div></section>`;
    }).join("")
    : '<p class="helper">Crea una sección para empezar a organizar tu carta.</p>';
}

function abrirSeccion(id = null) {
  const seccion = state.catalogo.categorias.find((c) => c.id === id);
  state.seccionId = seccion?.id || null;
  $("#section-dialog-title").textContent = seccion ? "Editar sección" : "Nueva sección";
  $("#section-name").value = seccion?.nombre || "";
  sectionDialog.showModal();
}
async function guardarSeccion(event) {
  event.preventDefault();
  const boton = event.currentTarget.querySelector("[type=submit]");
  setBusy(boton, true, "Guardando…");
  try {
    await invokeRappi("rappi-menu", {
      action: "guardar_categoria", id: state.seccionId, nombre: $("#section-name").value.trim(),
      orden: state.seccionId ? state.catalogo.categorias.find((c) => c.id === state.seccionId).orden : state.catalogo.categorias.length + 1,
    });
    sectionDialog.close();
    await cargar();
  } catch (error) { toast(error.message, "error"); }
  finally { setBusy(boton, false); }
}

async function accionListado(event) {
  const boton = event.target.closest("button");
  if (!boton) return;
  const seccionEl = boton.closest("[data-section]");
  const seccionId = seccionEl?.dataset.section;
  const productoEl = boton.closest("[data-product]");
  const productoId = productoEl?.dataset.product;
  if (boton.hasAttribute("data-toggle-section")) {
    const cerrada = boton.getAttribute("aria-expanded") === "true";
    state.seccionesAbiertas.delete(seccionId);
    state.seccionesAbiertas.delete("cerrada:" + seccionId);
    state.seccionesAbiertas.add((cerrada ? "cerrada:" : "") + seccionId);
    render();
  } else if (boton.hasAttribute("data-add-product")) abrirProducto(null, seccionId);
  else if (boton.hasAttribute("data-edit-product")) abrirProducto(productoId);
  else if (boton.hasAttribute("data-edit-section")) abrirSeccion(seccionId);
  else if (boton.hasAttribute("data-delete-product")) await borrarProducto(productoId);
  else if (boton.hasAttribute("data-delete-section")) await borrarSeccion(seccionId);
  else if (boton.hasAttribute("data-move-section")) await moverSeccion(seccionId, Number(boton.dataset.moveSection));
  else if (boton.hasAttribute("data-move-product")) await moverProducto(productoId, Number(boton.dataset.moveProduct));
}
async function borrarSeccion(id) {
  const seccion = state.catalogo.categorias.find((c) => c.id === id);
  if (state.catalogo.productos.some((p) => p.categoria_id === id))
    return toast("Mueve los productos a otra sección antes de borrarla.", "error");
  if (!confirm(`¿Borrar la sección «${seccion?.nombre}»?`)) return;
  try { await invokeRappi("rappi-menu", { action: "borrar_categoria", id }); await cargar(); }
  catch (error) { toast(error.message, "error"); }
}
async function borrarProducto(id) {
  const producto = state.catalogo.productos.find((p) => p.id === id);
  if (!confirm(`¿Borrar «${producto?.nombre}»? Saldrá de Rappi en la próxima publicación.`)) return;
  try { await invokeRappi("rappi-menu", { action: "borrar_producto", id }); await cargar(); }
  catch (error) { toast(error.message, "error"); }
}
async function moverSeccion(id, delta) {
  const lista = [...state.catalogo.categorias].sort((a, b) => a.orden - b.orden);
  const i = lista.findIndex((c) => c.id === id);
  if (i + delta < 0 || i + delta >= lista.length) return;
  [lista[i], lista[i + delta]] = [lista[i + delta], lista[i]];
  try {
    for (const [orden, c] of lista.entries())
      await invokeRappi("rappi-menu", { action: "guardar_categoria", id: c.id, nombre: c.nombre, orden: orden + 1 });
    await cargar();
  } catch (error) { toast(error.message, "error"); }
}
async function moverProducto(id, delta) {
  const producto = state.catalogo.productos.find((p) => p.id === id);
  const lista = state.catalogo.productos.filter((p) => p.categoria_id === producto.categoria_id)
    .sort((a, b) => a.orden - b.orden);
  const i = lista.findIndex((p) => p.id === id);
  if (i + delta < 0 || i + delta >= lista.length) return;
  [lista[i], lista[i + delta]] = [lista[i + delta], lista[i]];
  try {
    for (const [orden, p] of lista.entries())
      await guardarProductoExistente(p, orden + 1);
    await cargar();
  } catch (error) { toast(error.message, "error"); }
}
function guardarProductoExistente(p, orden) {
  return invokeRappi("rappi-menu", {
    action: "guardar_producto", id: p.id, nombre: p.nombre, descripcion: p.descripcion,
    precio: Number(p.precio), categoria_id: p.categoria_id, imagen_path: p.imagen_path,
    activo: p.activo, orden,
  });
}

function abrirProducto(id, seccionId = null) {
  const producto = state.catalogo.productos.find((p) => p.id === id);
  state.productoId = producto?.id || null;
  state.imagenPath = producto?.imagen_path || null;
  $("#product-dialog-title").textContent = producto?.nombre || "Nuevo producto";
  $("#product-name").value = producto?.nombre || "";
  $("#product-price").value = producto ? Number(producto.precio) : "";
  $("#product-description").value = producto?.descripcion || "";
  $("#product-new-category").value = "";
  $("#product-active").checked = producto ? producto.activo : true;
  $("#product-image").value = "";
  $("#product-image-preview").src = producto?.imagen_url || "";
  $("#product-image-preview").hidden = !producto?.imagen_url;
  $("#product-category").innerHTML = state.catalogo.categorias.map((c) =>
    `<option value="${escapeHtml(c.id)}">${escapeHtml(c.nombre)}</option>`).join("");
  $("#product-category").value = producto?.categoria_id || seccionId || state.catalogo.categorias[0]?.id || "";
  $("#product-questions").innerHTML = "";
  for (const enlace of producto?.grupos || []) {
    const grupo = state.catalogo.grupos.find((g) => g.id === enlace.grupo_id);
    if (grupo) agregarPregunta(grupo, enlace);
  }
  productDialog.showModal();
}

function agregarPregunta(grupo = null, enlace = null) {
  const bloque = document.createElement("section");
  bloque.className = "menu-question";
  bloque.dataset.groupId = grupo?.id || "";
  const otras = state.catalogo.grupos.filter((g) => g.opciones?.length)
    .map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.nombre)}</option>`).join("");
  bloque.innerHTML = `<div class="menu-question-head"><strong>Pregunta al cliente</strong>
    <div><button class="button secondary compact" type="button" data-move-question="-1">↑</button>
    <button class="button secondary compact" type="button" data-move-question="1">↓</button>
    <button class="button secondary compact" type="button" data-remove-question>Quitar</button></div></div>
    <div class="field"><label>Pregunta</label><input class="question-name" maxlength="80" required value="${escapeHtml(grupo?.nombre || "")}" placeholder="Ej: Elige tus toppings"></div>
    <div class="menu-choice-range"><span>¿Cuántas puede elegir? De</span>
      <input class="question-min" type="number" min="0" step="1" value="${enlace?.min_qty ?? grupo?.min_qty ?? 0}" aria-label="Mínimo">
      <span>a</span><input class="question-max" type="number" min="1" step="1" value="${enlace?.max_qty ?? grupo?.max_qty ?? 1}" aria-label="Máximo"></div>
    <div class="menu-copy"><label>Usar una pregunta que ya tengo
      <select class="question-copy"><option value="">Elegir…</option>${otras}</select></label>
      <button class="button secondary compact" type="button" data-copy-question>Copiar como nueva</button></div>
    <div class="menu-options"></div>
    <button class="button secondary compact" type="button" data-add-option>Agregar respuesta</button>`;
  $("#product-questions").appendChild(bloque);
  for (const opcion of grupo?.opciones || []) agregarOpcion(bloque, opcion);
  if (!grupo) agregarOpcion(bloque);
}
function agregarOpcion(bloque, opcion = null) {
  const fila = document.createElement("div");
  fila.className = "menu-option";
  fila.dataset.optionId = opcion?.id || "";
  fila.innerHTML = `<input class="option-name" maxlength="80" required placeholder="Respuesta" value="${escapeHtml(opcion?.nombre || "")}" aria-label="Nombre de la respuesta">
    <input class="option-price" type="number" min="0" step="0.01" value="${opcion ? Number(opcion.precio) : 0}" aria-label="Precio adicional">
    <label class="option-limit">Hasta <input class="option-max" type="number" min="1" step="1" value="${opcion?.max_limit || 1}" aria-label="Repeticiones de la respuesta"> veces</label>
    <label class="option-active"><input type="checkbox" ${opcion?.activo === false ? "" : "checked"}> Activa</label>
    <button class="button secondary compact" type="button" data-move-option="-1" aria-label="Subir respuesta">↑</button>
    <button class="button secondary compact" type="button" data-move-option="1" aria-label="Bajar respuesta">↓</button>
    <button class="button secondary compact" type="button" data-remove-option>Quitar</button>
    <input class="option-description" maxlength="500" value="${escapeHtml(opcion?.descripcion ?? opcion?.nombre ?? "")}" placeholder="Descripción de la respuesta" aria-label="Descripción de la respuesta"> `;
  bloque.querySelector(".menu-options").appendChild(fila);
}
function accionPregunta(event) {
  const boton = event.target.closest("button");
  if (!boton) return;
  const bloque = boton.closest(".menu-question");
  if (boton.hasAttribute("data-remove-question")) bloque.remove();
  else if (boton.hasAttribute("data-add-option")) agregarOpcion(bloque);
  else if (boton.hasAttribute("data-remove-option")) boton.closest(".menu-option").remove();
  else if (boton.hasAttribute("data-move-question")) moverNodo(bloque, Number(boton.dataset.moveQuestion));
  else if (boton.hasAttribute("data-move-option")) moverNodo(boton.closest(".menu-option"), Number(boton.dataset.moveOption));
  else if (boton.hasAttribute("data-copy-question")) {
    const fuente = state.catalogo.grupos.find((g) => g.id === bloque.querySelector(".question-copy").value);
    if (!fuente) return toast("Elige una pregunta existente.", "error");
    agregarPregunta({ ...fuente, id: null, opciones: fuente.opciones.map((o) => ({ ...o, id: null, rappi_sku: null })) });
  }
}
function moverNodo(nodo, delta) {
  if (delta < 0 && nodo.previousElementSibling) nodo.parentNode.insertBefore(nodo, nodo.previousElementSibling);
  if (delta > 0 && nodo.nextElementSibling) nodo.parentNode.insertBefore(nodo.nextElementSibling, nodo);
}
function previsualizarImagen(event) {
  const archivo = event.currentTarget.files?.[0];
  if (!archivo) return;
  $("#product-image-preview").src = URL.createObjectURL(archivo);
  $("#product-image-preview").hidden = false;
}
async function subirImagen(archivo) {
  if (archivo.size > 3_000_000) throw new Error("La foto no puede pesar más de 3 MB.");
  const extension = (archivo.name.split(".").pop() || "jpg").toLowerCase();
  if (!["jpg", "jpeg", "png", "webp"].includes(extension)) throw new Error("Usa una foto JPG, PNG o WebP.");
  const ruta = `${getRappiContext().empresa_id}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, archivo, { contentType: archivo.type });
  if (error) throw new Error(`No se pudo subir la foto: ${error.message}`);
  return ruta;
}
function leerPreguntas() {
  const preguntas = [...$("#product-questions").querySelectorAll(".menu-question")].map((bloque) => ({
    id: bloque.dataset.groupId || null,
    nombre: bloque.querySelector(".question-name").value.trim(),
    min_qty: Number(bloque.querySelector(".question-min").value),
    max_qty: Number(bloque.querySelector(".question-max").value),
    opciones: [...bloque.querySelectorAll(".menu-option")].map((fila) => ({
      id: fila.dataset.optionId || null,
      nombre: fila.querySelector(".option-name").value.trim(),
      descripcion: fila.querySelector(".option-description").value.trim(),
      precio: Number(fila.querySelector(".option-price").value),
      max_limit: Number(fila.querySelector(".option-max").value),
      activo: fila.querySelector(".option-active input").checked,
    })),
  }));
  const total = preguntas.reduce((n, p) => n + p.opciones.length, 0);
  if (total > 50) throw new Error("El producto no puede tener más de 50 respuestas.");
  for (const pregunta of preguntas) {
    const activas = pregunta.opciones.filter((o) => o.activo && o.nombre).length;
    if (!pregunta.nombre || !activas) throw new Error("Cada pregunta necesita un nombre y respuestas activas.");
    if (pregunta.min_qty < 0 || pregunta.max_qty < pregunta.min_qty || pregunta.max_qty > activas)
      throw new Error(`En «${pregunta.nombre}», el máximo debe estar entre el mínimo y las respuestas activas.`);
  }
  return preguntas;
}
async function guardarProducto(event) {
  event.preventDefault();
  const boton = event.currentTarget.querySelector("[type=submit]");
  setBusy(boton, true, "Guardando…");
  try {
    let categoriaId = $("#product-category").value;
    const nueva = $("#product-new-category").value.trim();
    if (nueva) {
      const creada = await invokeRappi("rappi-menu", { action: "guardar_categoria", nombre: nueva, orden: state.catalogo.categorias.length + 1 });
      categoriaId = creada.id;
    }
    if (!categoriaId) throw new Error("Selecciona o crea una sección del menú.");
    const preguntas = leerPreguntas();
    const archivo = $("#product-image").files?.[0];
    if (archivo) state.imagenPath = await subirImagen(archivo);
    const anterior = state.catalogo.productos.find((p) => p.id === state.productoId);
    await invokeRappi("rappi-menu", {
      action: "guardar_producto", id: state.productoId,
      nombre: $("#product-name").value.trim(), descripcion: $("#product-description").value.trim(),
      precio: Number($("#product-price").value), categoria_id: categoriaId,
      imagen_path: state.imagenPath, activo: $("#product-active").checked,
      orden: anterior?.orden ?? state.catalogo.productos.filter((p) => p.categoria_id === categoriaId).length + 1,
      preguntas,
    });
    productDialog.close();
    toast("Producto guardado. Publícalo para que Rappi lo muestre.");
    await cargar();
  } catch (error) { toast(error.message, "error"); }
  finally { setBusy(boton, false); }
}
async function publicar() {
  const boton = $("#publish-menu");
  if (!state.tiendaId) return toast("Elige una tienda.", "error");
  const activos = state.catalogo.productos.filter((p) => p.activo);
  if (!activos.length) return toast("No hay productos activos.", "error");
  let comparacion;
  try {
    comparacion = await invokeRappi("rappi-menu", {
      action: "comparar_publicacion", store_id: state.tiendaId, environment: "DEV",
    });
  } catch (error) { return toast(error.message, "error"); }
  if (!confirm(`La carta actual de Rappi tiene ${comparacion.productos_actuales} productos y ${comparacion.respuestas_actuales} respuestas.\n\nLa propuesta tiene ${comparacion.productos_propuestos} productos y ${comparacion.respuestas_propuestas} respuestas. Se retirarían ${comparacion.productos_retirados} productos.\n\nSe reemplazará toda la carta. ¿Publicar?`)) return;
  setBusy(boton, true, "Publicando…");
  try {
    const resultado = await invokeRappi("rappi-menu", {
      action: "publicar", store_id: state.tiendaId, environment: "DEV",
    });
    toast(`Enviados ${resultado.publicados} productos. Rappi debe aprobar la carta.`);
    await cargar();
  } catch (error) { toast(error.message, "error"); }
  finally { setBusy(boton, false); }
}
function seguirSalida() {
  state.allowLeave = true;
  if (state.intentoSalida) location.href = state.intentoSalida;
}
