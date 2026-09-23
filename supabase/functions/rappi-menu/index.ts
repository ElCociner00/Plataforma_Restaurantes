import { corsHeaders, json } from "../_shared/cors.ts";
import { errores, ErrorFuncion, leerCuerpo, responderError } from "../_shared/errores.ts";
import { type Contexto, exigirAccesoEscritura, exigirAdmin, resolverContexto } from "../_shared/tenant.ts";
import { rappiRequestWithStatus } from "../_shared/rappi/client.ts";
import type { RappiConnection } from "../_shared/rappi/types.ts";
import { buildRappiItems, menuSlug, type MenuCategory, type MenuGroup, type MenuProduct, type MenuOption } from "./payload.ts";

/**
 * Menú de Rappi autogestionable.
 *
 * Rappi reemplaza el menú completo en cada envío: no existe "crear un
 * producto". Aquí el menú vive en tablas (categorías, grupos de opciones,
 * opciones y productos), el cliente edita de a uno, y "publicar" arma el JSON
 * entero y lo manda. Nadie tiene que ver un JSON nunca.
 */
const LABEL = "rappi-menu";
const PUBLIC_API = "/api/v2/restaurants-integrations-public-api";
const MENU_PATH = `${PUBLIC_API}/menu`;
const BUCKET = "rappi-menu";

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, origin);
  try {
    const body = await leerCuerpo(req);
    const ctx = await resolverContexto(req, text(body.empresa_id) || null);
    exigirAdmin(ctx, "gestionar el menú de Rappi");
    const action = text(body.action).toLowerCase();
    // El catálogo es una consulta; todo lo demás cambia el catálogo local o
    // publica en Rappi y debe respetar el ciclo de vida de la cuenta.
    if (action !== "catalogo" && action !== "comparar_publicacion") await exigirAccesoEscritura(ctx);
    let result: unknown;
    switch (action) {
      case "catalogo": result = await catalogo(ctx); break;
      case "guardar_categoria": result = await guardarCategoria(ctx, body); break;
      case "borrar_categoria": result = await borrarCategoria(ctx, body); break;
      case "guardar_grupo": result = await guardarGrupo(ctx, body); break;
      case "borrar_grupo": result = await borrar(ctx, "rappi_menu_grupos", body); break;
      case "guardar_producto": result = await guardarProducto(ctx, body); break;
      case "borrar_producto": result = await borrarProducto(ctx, body); break;
      case "publicar": result = await publicar(ctx, body); break;
      case "comparar_publicacion": result = await compararPublicacion(ctx, body); break;
      case "importar": result = await importar(ctx, body); break;
      case "sincronizar": result = await importar(ctx, body); break;
      default: throw new ErrorFuncion("UNKNOWN_ACTION", "La acción solicitada no existe.", 400);
    }
    if (["guardar_categoria", "borrar_categoria", "guardar_grupo", "borrar_grupo", "guardar_producto", "borrar_producto"].includes(action)) {
      await actualizarHashLocal(ctx);
    }
    return json({ ok: true, data: result }, 200, origin);
  } catch (error) {
    return responderError(error, origin, LABEL);
  }
});

const text = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value).trim();

const entero = (value: unknown, porDefecto = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : porDefecto;
};

/**
 * Todo id que llega del navegador se valida como UUID antes de usarse: se
 * interpolan en filtros de PostgREST y en rutas de Storage.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuid = (value: unknown, campo: string): string => {
  const valor = text(value);
  if (!UUID.test(valor)) throw errores.datosIncompletos(campo);
  return valor;
};

const uuidOpcional = (value: unknown, campo: string): string | null => {
  const valor = text(value);
  return valor ? uuid(valor, campo) : null;
};

/** Rappi rechaza el menú entero por un texto demasiado largo o vacío. */
const texto = (value: unknown, campo: string, maximo: number, obligatorio = true): string => {
  const valor = text(value).slice(0, maximo);
  if (obligatorio && !valor) throw errores.datosIncompletos(campo);
  return valor;
};

const dinero = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new ErrorFuncion("PRECIO_INVALIDO", "El precio debe ser un número válido.", 400);
  return Math.round(n * 100) / 100;
};

/** Imagen pública del bucket; Rappi solo acepta una URL. */
function imagenUrl(path: string | null): string | null {
  const base = Deno.env.get("SUPABASE_URL");
  if (!path || !base) return null;
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
}

/**
 * La ruta de la imagen llega del navegador: se exige que esté dentro de la
 * carpeta de la empresa, o un cliente podría apuntar (y al borrar el producto,
 * borrar) la foto de otro restaurante.
 */
function imagenPropia(ctx: Contexto, value: unknown): string | null {
  const ruta = text(value);
  if (!ruta) return null;
  if (!ruta.startsWith(`${ctx.empresaId}/`) || ruta.includes("..")) {
    throw new ErrorFuncion("IMAGEN_AJENA", "La foto no pertenece a esta empresa.", 403);
  }
  return ruta.slice(0, 300);
}

/** SKU consecutivo por empresa: el cliente nunca escribe uno. */
async function siguienteSku(ctx: Contexto, prefijo: "P" | "O"): Promise<string> {
  const db = ctx.clienteAdmin();
  const { data, error } = await db.rpc("rappi_menu_siguiente_consecutivo", { p_empresa_id: ctx.empresaId });
  if (error) throw errores.baseDeDatos(error.message);
  return `ENK-${prefijo}-${String(entero(data, 1)).padStart(5, "0")}`;
}

async function catalogo(ctx: Contexto) {
  const db = ctx.clienteAdmin();
  const [categorias, grupos, opciones, productos, enlaces, tiendas, versiones, estados] = await Promise.all([
    db.from("rappi_menu_categorias").select("id, nombre, orden, rappi_category_id").eq("empresa_id", ctx.empresaId).order("orden").order("nombre"),
    db.from("rappi_menu_grupos").select("id, nombre, min_qty, max_qty, orden, rappi_group_id").eq("empresa_id", ctx.empresaId).order("orden").order("nombre"),
    db.from("rappi_menu_opciones").select("id, grupo_id, sku, rappi_sku, nombre, descripcion, precio, activo, orden, max_limit").eq("empresa_id", ctx.empresaId).order("orden").order("nombre"),
    db.from("rappi_menu_productos").select("id, categoria_id, sku, rappi_sku, nombre, descripcion, precio, imagen_path, rappi_image_url, activo, orden, actualizado_en").eq("empresa_id", ctx.empresaId).order("orden").order("nombre"),
    db.from("rappi_menu_producto_grupos").select("producto_id, grupo_id, orden, min_qty, max_qty"),
    db.from("rappi_stores").select("id, store_name, rappi_store_id, menu_approval_status")
      .or(`empresa_id.eq.${ctx.empresaId},enkrato_empresa_id.eq.${ctx.empresaId}`).eq("active", true).order("store_name"),
    db.from("rappi_menu_versions").select("store_id, item_count, approval_status, received_at, source")
      .eq("empresa_id", ctx.empresaId).order("received_at", { ascending: false }).limit(20),
    db.from("rappi_menu_estado").select("store_id, hash_local, hash_publicado, hash_pendiente, approval_status, actualizado_en")
      .eq("empresa_id", ctx.empresaId),
  ]);
  for (const r of [categorias, grupos, opciones, productos, enlaces, tiendas, versiones, estados]) {
    if (r.error) throw errores.baseDeDatos(r.error.message);
  }
  const idsPropios = new Set((productos.data ?? []).map((producto) => producto.id));
  const porProducto = new Map<string, { grupo_id: string; orden: number; min_qty: number | null; max_qty: number | null }[]>();
  for (const fila of enlaces.data ?? []) {
    if (!idsPropios.has(fila.producto_id)) continue;
    const lista = porProducto.get(fila.producto_id) ?? [];
    lista.push({ grupo_id: fila.grupo_id, orden: fila.orden, min_qty: fila.min_qty, max_qty: fila.max_qty });
    porProducto.set(fila.producto_id, lista);
  }
  const ultimaPorTienda = new Map<string, Record<string, unknown>>();
  for (const v of versiones.data ?? []) if (!ultimaPorTienda.has(v.store_id)) ultimaPorTienda.set(v.store_id, v);

  return {
    categorias: categorias.data ?? [],
    grupos: (grupos.data ?? []).map((grupo) => ({
      ...grupo,
      opciones: (opciones.data ?? []).filter((o) => o.grupo_id === grupo.id),
    })),
    productos: (productos.data ?? []).map((producto) => ({
      ...producto,
      imagen_url: producto.rappi_image_url || imagenUrl(producto.imagen_path),
      grupos: (porProducto.get(producto.id) ?? []).sort((a, b) => a.orden - b.orden),
    })),
    tiendas: (tiendas.data ?? []).map((tienda) => ({
      ...tienda,
      ultima_publicacion: ultimaPorTienda.get(tienda.id) ?? null,
      estado_menu: (estados.data ?? []).find((estado) => estado.store_id === tienda.id) ?? null,
    })),
  };
}

async function guardarCategoria(ctx: Contexto, body: Record<string, unknown>) {
  const nombre = texto(body.nombre, "nombre", 60);
  const db = ctx.clienteAdmin();
  const fila = { empresa_id: ctx.empresaId, nombre, orden: entero(body.orden) };
  const id = uuidOpcional(body.id, "id");
  const { data, error } = id
    ? await db.from("rappi_menu_categorias").update(fila).eq("id", id).eq("empresa_id", ctx.empresaId).select("id").maybeSingle()
    : await db.from("rappi_menu_categorias").insert({ ...fila, rappi_category_id: `SEC-${menuSlug(nombre)}` }).select("id").maybeSingle();
  if (error) throw conflictoNombre(error.message, "categoría");
  if (!data?.id) throw new ErrorFuncion("CATEGORIA_NO_ENCONTRADA", "La categoría no existe.", 404);
  return { id: data.id };
}

async function guardarGrupo(ctx: Contexto, body: Record<string, unknown>) {
  const opcionesEntrada = Array.isArray(body.opciones) ? body.opciones as Record<string, unknown>[] : [];
  const nombre = texto(body.nombre, "nombre", 80);
  const minQty = Math.max(0, entero(body.min_qty));
  const maxQty = Math.max(minQty, entero(body.max_qty, 1));
  const activas = opcionesEntrada.filter((opcion) => opcion.activo !== false).length;
  if (!activas || minQty > maxQty || maxQty > activas) {
    throw new ErrorFuncion("GRUPO_INVALIDO", "La pregunta debe tener respuestas activas y el máximo no puede superarlas.", 400);
  }
  const db = ctx.clienteAdmin();
  const fila = { empresa_id: ctx.empresaId, nombre, min_qty: minQty, max_qty: maxQty, orden: entero(body.orden) };
  const id = uuidOpcional(body.id, "id");
  const { data, error } = id
    ? await db.from("rappi_menu_grupos").update(fila).eq("id", id).eq("empresa_id", ctx.empresaId).select("id").maybeSingle()
    : await db.from("rappi_menu_grupos").insert(fila).select("id").maybeSingle();
  if (error) throw conflictoNombre(error.message, "grupo de opciones");
  // Sin fila devuelta el id no es de esta empresa: no se sigue trabajando con él.
  const grupoId = data?.id;
  if (!grupoId) throw new ErrorFuncion("GRUPO_NO_ENCONTRADO", "El grupo de opciones no existe.", 404);

  const conservados: string[] = [];
  for (const [indice, entrada] of opcionesEntrada.entries()) {
    const opcionId = uuidOpcional(entrada.id, "id de la opción");
    const opcion = {
      empresa_id: ctx.empresaId,
      grupo_id: grupoId,
      nombre: texto(entrada.nombre, "nombre de cada opción", 80),
      descripcion: texto(entrada.descripcion ?? entrada.nombre, "descripción de la opción", 500, false),
      precio: dinero(entrada.precio ?? 0),
      activo: entrada.activo !== false,
      orden: indice,
      max_limit: Math.max(1, entero(entrada.max_limit, 1)),
    };
    if (opcionId) {
      const { data: actualizada, error: errUpd } = await db.from("rappi_menu_opciones").update(opcion)
        .eq("id", opcionId).eq("grupo_id", grupoId).eq("empresa_id", ctx.empresaId).select("id").maybeSingle();
      if (errUpd) throw errores.baseDeDatos(errUpd.message);
      if (actualizada?.id) conservados.push(actualizada.id);
    } else {
      const { data: creada, error: errIns } = await db.from("rappi_menu_opciones")
        .insert({ ...opcion, sku: await siguienteSku(ctx, "O") }).select("id").maybeSingle();
      if (errIns) throw errores.baseDeDatos(errIns.message);
      if (creada?.id) conservados.push(creada.id);
    }
  }
  const borrado = db.from("rappi_menu_opciones").delete().eq("grupo_id", grupoId).eq("empresa_id", ctx.empresaId);
  const { error: errDel } = conservados.length ? await borrado.not("id", "in", `(${conservados.join(",")})`) : await borrado;
  if (errDel) throw errores.baseDeDatos(errDel.message);
  return { id: grupoId, opciones: conservados.length };
}

async function guardarProducto(ctx: Contexto, body: Record<string, unknown>) {
  const nombre = texto(body.nombre, "nombre", 120);
  const precio = dinero(body.precio);
  if (precio <= 0) throw new ErrorFuncion("PRECIO_INVALIDO", "El precio debe ser mayor que cero: Rappi rechaza los productos en $0.", 400);
  const db = ctx.clienteAdmin();
  const id = uuidOpcional(body.id, "id");
  const categoriaId = uuidOpcional(body.categoria_id, "categoria_id");
  if (categoriaId) {
    const { data: categoria, error: errorCategoria } = await db.from("rappi_menu_categorias")
      .select("id").eq("id", categoriaId).eq("empresa_id", ctx.empresaId).maybeSingle();
    if (errorCategoria) throw errores.baseDeDatos(errorCategoria.message);
    if (!categoria) throw new ErrorFuncion("CATEGORIA_NO_ENCONTRADA", "La sección no pertenece a este restaurante.", 404);
  }
  const fila = {
    empresa_id: ctx.empresaId,
    categoria_id: categoriaId,
    nombre,
    descripcion: texto(body.descripcion, "descripcion", 500, false),
    precio,
    imagen_path: imagenPropia(ctx, body.imagen_path),
    ...(text(body.imagen_path) ? { rappi_image_url: null } : {}),
    activo: body.activo !== false,
    orden: entero(body.orden),
    actualizado_en: new Date().toISOString(),
  };
  // La foto anterior se borra del bucket: si no, cada cambio deja basura.
  const { data: previo } = id
    ? await db.from("rappi_menu_productos").select("imagen_path").eq("id", id).eq("empresa_id", ctx.empresaId)
      .maybeSingle<{ imagen_path: string | null }>()
    : { data: null };
  const { data, error } = id
    ? await db.from("rappi_menu_productos").update(fila).eq("id", id).eq("empresa_id", ctx.empresaId).select("id, imagen_path").maybeSingle()
    : await db.from("rappi_menu_productos").insert({ ...fila, sku: await siguienteSku(ctx, "P") }).select("id, imagen_path").maybeSingle();
  if (error) throw conflictoNombre(error.message, "producto");
  const productoId = data?.id;
  if (!productoId) throw new ErrorFuncion("PRODUCTO_NO_ENCONTRADO", "El producto no existe.", 404);

  if (previo?.imagen_path && previo.imagen_path !== fila.imagen_path) {
    const { error: errStorage } = await db.storage.from(BUCKET).remove([previo.imagen_path]);
    if (errStorage) console.warn(`[${LABEL}] no se pudo borrar la foto anterior:`, errStorage.message);
  }

  if (Array.isArray(body.preguntas)) {
    await guardarPreguntasProducto(ctx, productoId, body.preguntas as Record<string, unknown>[]);
  } else if (Array.isArray(body.grupos)) {
    const pedidos = [...new Set((body.grupos as unknown[]).map((g) => uuid(g, "grupo")))];
    // Solo se enlazan grupos de la propia empresa: los ids llegan del navegador.
    const { data: propios } = await db.from("rappi_menu_grupos").select("id")
      .eq("empresa_id", ctx.empresaId).in("id", pedidos.length ? pedidos : ["00000000-0000-0000-0000-000000000000"]);
    const grupos = (propios ?? []).map((g) => g.id);
    const { error: errDel } = await db.from("rappi_menu_producto_grupos").delete().eq("producto_id", productoId);
    if (errDel) throw errores.baseDeDatos(errDel.message);
    if (grupos.length) {
      const { error: errIns } = await db.from("rappi_menu_producto_grupos")
        .insert(grupos.map((grupoId, orden) => ({ producto_id: productoId, grupo_id: grupoId, orden })));
      if (errIns) throw errores.baseDeDatos(errIns.message);
    }
  }
  return { id: productoId };
}

async function guardarPreguntasProducto(ctx: Contexto, productoId: string, preguntas: Record<string, unknown>[]) {
  const db = ctx.clienteAdmin();
  if (preguntas.reduce((total, pregunta) => total + (Array.isArray(pregunta.opciones) ? pregunta.opciones.length : 0), 0) > 50) {
    throw new ErrorFuncion("DEMASIADAS_RESPUESTAS", "El producto no puede tener más de 50 respuestas.", 400);
  }
  const { data: enlacesPrevios, error: enlacesError } = await db.from("rappi_menu_producto_grupos")
    .select("grupo_id").eq("producto_id", productoId);
  if (enlacesError) throw errores.baseDeDatos(enlacesError.message);
  const enlacesNuevos: { producto_id: string; grupo_id: string; orden: number; min_qty: number; max_qty: number }[] = [];
  for (const [orden, pregunta] of preguntas.entries()) {
    let grupoId = uuidOpcional(pregunta.id, "id de la pregunta");
    let opciones = Array.isArray(pregunta.opciones) ? pregunta.opciones as Record<string, unknown>[] : [];
    const minQty = Math.max(0, entero(pregunta.min_qty));
    const maxQty = Math.max(1, entero(pregunta.max_qty, 1));
    const activas = opciones.filter((opcion) => opcion.activo !== false).length;
    if (!activas || minQty > maxQty || maxQty > activas) {
      throw new ErrorFuncion("PREGUNTA_INVALIDA", "Cada pregunta necesita respuestas activas y un máximo que no las supere.", 400);
    }
    if (grupoId) {
      const { data: enlaces, error } = await db.from("rappi_menu_producto_grupos")
        .select("producto_id").eq("grupo_id", grupoId);
      if (error) throw errores.baseDeDatos(error.message);
      if (enlaces?.some((enlace) => enlace.producto_id !== productoId)) {
        grupoId = null;
        opciones = opciones.map(({ id: _id, ...opcion }) => opcion);
      }
    }
    const guardado = await guardarGrupo(ctx, {
      id: grupoId, nombre: pregunta.nombre, min_qty: minQty, max_qty: maxQty,
      orden, opciones,
    });
    enlacesNuevos.push({ producto_id: productoId, grupo_id: guardado.id, orden, min_qty: minQty, max_qty: maxQty });
  }
  const { error: borradoError } = await db.from("rappi_menu_producto_grupos").delete().eq("producto_id", productoId);
  if (borradoError) throw errores.baseDeDatos(borradoError.message);
  if (enlacesNuevos.length) {
    const { error: insertError } = await db.from("rappi_menu_producto_grupos").insert(enlacesNuevos);
    if (insertError) throw errores.baseDeDatos(insertError.message);
  }
  for (const enlace of enlacesPrevios ?? []) {
    if (enlacesNuevos.some((nuevo) => nuevo.grupo_id === enlace.grupo_id)) continue;
    const { data: otros } = await db.from("rappi_menu_producto_grupos")
      .select("producto_id").eq("grupo_id", enlace.grupo_id).limit(1);
    if (!otros?.length) await db.from("rappi_menu_grupos").delete()
      .eq("id", enlace.grupo_id).eq("empresa_id", ctx.empresaId);
  }
}

async function borrarProducto(ctx: Contexto, body: Record<string, unknown>) {
  const db = ctx.clienteAdmin();
  const id = uuid(body.id, "id");
  const { data } = await db.from("rappi_menu_productos").select("imagen_path")
    .eq("id", id).eq("empresa_id", ctx.empresaId).maybeSingle<{ imagen_path: string | null }>();
  const { error } = await db.from("rappi_menu_productos").delete().eq("id", id).eq("empresa_id", ctx.empresaId);
  if (error) throw errores.baseDeDatos(error.message);
  if (data?.imagen_path) await db.storage.from(BUCKET).remove([data.imagen_path]).catch(() => {});
  return { borrado: true };
}

async function borrar(ctx: Contexto, tabla: string, body: Record<string, unknown>) {
  const id = uuid(body.id, "id");
  const { error } = await ctx.clienteAdmin().from(tabla).delete().eq("id", id).eq("empresa_id", ctx.empresaId);
  if (error) throw errores.baseDeDatos(error.message);
  return { borrado: true };
}

function conflictoNombre(mensaje: string, que: string): ErrorFuncion {
  if (/duplicate key|unique/i.test(mensaje)) {
    return new ErrorFuncion("NOMBRE_REPETIDO", `Ya existe un ${que} con ese nombre.`, 409);
  }
  return errores.baseDeDatos(mensaje);
}

/**
 * Arma el menú completo tal como lo espera Rappi y lo envía. Cada publicación
 * reemplaza el menú de esa tienda, así que siempre se manda todo lo activo.
 */
async function publicar(ctx: Contexto, body: Record<string, unknown>) {
  const storeId = uuid(body.store_id, "store_id");
  const environment = text(body.environment).toUpperCase() === "PROD" ? "PROD" : "DEV";
  const db = ctx.clienteAdmin();

  const { data: connection } = await db.from("rappi_connections")
    .select("id, empresa_id, environment, status, operational_base_url, orders_base_url, financial_base_url, operational_enabled, financial_enabled")
    .eq("empresa_id", ctx.empresaId).eq("environment", environment).maybeSingle<RappiConnection>();
  if (!connection) throw new ErrorFuncion("RAPPI_NOT_CONFIGURED", "Configura primero la conexión con Rappi.", 412);

  const { data: store } = await db.from("rappi_stores").select("id, rappi_store_id, enkrato_empresa_id")
    .eq("id", storeId).eq("connection_id", connection.id).eq("active", true)
    .maybeSingle<{ id: string; rappi_store_id: string; enkrato_empresa_id: string | null }>();
  if (!store) throw new ErrorFuncion("RAPPI_STORE_NOT_FOUND", "La tienda no pertenece a esta conexión.", 404);

  const { data: estadoBase, error: errorEstadoBase } = await db.from("rappi_menu_estado")
    .select("hash_publicado, hash_pendiente").eq("empresa_id", ctx.empresaId)
    .eq("store_id", store.id).maybeSingle();
  if (errorEstadoBase) throw errores.baseDeDatos(errorEstadoBase.message);
  if (!estadoBase?.hash_publicado) {
    throw new ErrorFuncion("MENU_SIN_BASE", "Primero trae la carta actual de Rappi para verificarla antes de publicar.", 409);
  }
  if (estadoBase.hash_pendiente) {
    throw new ErrorFuncion("MENU_EN_REVISION", "Hay una carta en revisión por Rappi. Espera el resultado antes de enviar otra.", 409);
  }
  const remoto = await rappiRequestWithStatus(db, connection, "OPERATIONAL",
    `${PUBLIC_API}/menu/rappi/${encodeURIComponent(store.rappi_store_id)}`);
  if (remoto.status < 200 || remoto.status >= 300) {
    throw new ErrorFuncion("MENU_RAPPI_NO_DISPONIBLE", "No pudimos verificar la carta actual de Rappi; no se envió ningún cambio.", 502);
  }
  const itemsRemotos = itemsDeMenu(remoto.body);
  if (!itemsRemotos.length || await sha256Hex(JSON.stringify(itemsRemotos)) !== estadoBase.hash_publicado) {
    throw new ErrorFuncion("MENU_RAPPI_CAMBIO", "La carta cambió en Rappi desde la última sincronización. Revísala antes de publicar.", 409);
  }

  const { productos, grupos, categorias } = await datosPublicacion(ctx);
  const items = construirItems(productos, grupos, categorias);
  if (!items.length) {
    throw new ErrorFuncion("MENU_VACIO", "Agrega al menos un producto activo antes de publicar.", 400);
  }
  const sinImagen = productos.filter((p) => !p.imagen_path && !p.rappi_image_url).map((p) => p.nombre);
  validarItems(items);

  const response = await rappiRequestWithStatus(db, connection, "OPERATIONAL", MENU_PATH, {
    method: "POST",
    body: JSON.stringify({ storeId: store.rappi_store_id, items }),
  });
  if (response.status < 200 || response.status >= 300) {
    console.warn(`[${LABEL}] Rappi ${response.status}:`, JSON.stringify(response.body).slice(0, 1500));
    throw new ErrorFuncion(
      "RAPPI_MENU_RECHAZADO",
      motivoRechazo(response.body) ?? `Rappi no aceptó el menú (${response.status}).`,
      response.status >= 500 ? 502 : response.status,
    );
  }

  const contenido = { storeId: store.rappi_store_id, items };
  const hash = await sha256Hex(JSON.stringify(contenido));
  await db.from("rappi_menu_versions").upsert({
    store_id: store.id,
    empresa_id: store.enkrato_empresa_id ?? ctx.empresaId,
    content_hash: hash,
    approval_status: "PENDING",
    item_count: items.length,
    menu_data: contenido,
    source: "ENKRATO",
    received_at: new Date().toISOString(),
  }, { onConflict: "store_id,content_hash" });
  await db.from("rappi_stores").update({ menu_approval_status: "PENDING" }).eq("id", store.id);

  const hashLocal = await sha256Hex(JSON.stringify(items));
  const { data: estadoPrevio, error: lecturaEstadoError } = await db.from("rappi_menu_estado")
    .select("store_id").eq("empresa_id", ctx.empresaId).eq("store_id", store.id).maybeSingle();
  if (lecturaEstadoError) throw errores.baseDeDatos(lecturaEstadoError.message);
  const cambioEstado = {
    hash_local: hashLocal, hash_pendiente: hashLocal,
    approval_status: "PENDING", actualizado_en: new Date().toISOString(),
  };
  const { error: estadoError } = estadoPrevio
    ? await db.from("rappi_menu_estado").update(cambioEstado).eq("empresa_id", ctx.empresaId).eq("store_id", store.id)
    : await db.from("rappi_menu_estado").insert({ ...cambioEstado, empresa_id: ctx.empresaId, store_id: store.id });
  if (estadoError) throw errores.baseDeDatos(estadoError.message);

  return { publicados: items.length, sin_imagen: sinImagen };
}

type ProductoFila = MenuProduct;
type OpcionFila = MenuOption;
type GrupoFila = MenuGroup;

async function datosPublicacion(ctx: Contexto) {
  const db = ctx.clienteAdmin();
  const [productos, categorias, grupos, opciones] = await Promise.all([
    db.from("rappi_menu_productos").select("id, sku, rappi_sku, nombre, descripcion, precio, imagen_path, rappi_image_url, categoria_id, orden")
      .eq("empresa_id", ctx.empresaId).eq("activo", true).order("orden").order("nombre"),
    db.from("rappi_menu_categorias").select("id, nombre, orden, rappi_category_id").eq("empresa_id", ctx.empresaId).order("orden"),
    db.from("rappi_menu_grupos").select("id, nombre, min_qty, max_qty, orden, rappi_group_id").eq("empresa_id", ctx.empresaId).order("orden"),
    db.from("rappi_menu_opciones").select("id, grupo_id, sku, rappi_sku, nombre, descripcion, precio, orden, max_limit")
      .eq("empresa_id", ctx.empresaId).eq("activo", true).order("orden"),
  ]);
  for (const r of [productos, categorias, grupos, opciones]) {
    if (r.error) throw errores.baseDeDatos(r.error.message);
  }
  // service_role no debe leer ni siquiera enlaces de productos de otro tenant.
  const idsProducto = (productos.data ?? []).map((p: { id: string }) => p.id);
  const enlaces = idsProducto.length
    ? await db.from("rappi_menu_producto_grupos").select("producto_id, grupo_id, orden, min_qty, max_qty").in("producto_id", idsProducto).order("orden")
    : { data: [], error: null };
  if (enlaces.error) throw errores.baseDeDatos(enlaces.error.message);
  const porGrupo = new Map<string, { producto_id: string; orden: number; min_qty: number | null; max_qty: number | null }[]>();
  for (const fila of enlaces.data ?? []) {
    const lista = porGrupo.get(fila.grupo_id) ?? [];
    lista.push({ producto_id: fila.producto_id, orden: fila.orden, min_qty: fila.min_qty, max_qty: fila.max_qty });
    porGrupo.set(fila.grupo_id, lista);
  }
  return {
    productos: (productos.data ?? []) as ProductoFila[],
    categorias: (categorias.data ?? []) as MenuCategory[],
    grupos: ((grupos.data ?? []) as Omit<GrupoFila, "opciones" | "enlaces">[]).map((grupo) => ({
      ...grupo,
      opciones: ((opciones.data ?? []) as OpcionFila[]).filter((o) => o.grupo_id === grupo.id),
      enlaces: porGrupo.get(grupo.id) ?? [],
    })) as GrupoFila[],
  };
}

/**
 * Rappi pide ids de categoría como texto y los usa para agrupar en la app: se
 * generan estables a partir del orden (1000+ categorías, 2000+ grupos).
 */
function construirItems(productos: ProductoFila[], grupos: GrupoFila[], categorias: MenuCategory[]) {
  return buildRappiItems(productos, grupos, categorias, imagenUrl);
}

async function compararPublicacion(ctx: Contexto, body: Record<string, unknown>) {
  const storeId = uuid(body.store_id, "store_id");
  const environment = text(body.environment).toUpperCase() === "PROD" ? "PROD" : "DEV";
  const db = ctx.clienteAdmin();
  const { data: connection } = await db.from("rappi_connections")
    .select("id, empresa_id, environment, status, operational_base_url, orders_base_url, financial_base_url, operational_enabled, financial_enabled")
    .eq("empresa_id", ctx.empresaId).eq("environment", environment).maybeSingle<RappiConnection>();
  if (!connection) throw new ErrorFuncion("RAPPI_NOT_CONFIGURED", "Configura primero Rappi.", 412);
  const { data: store } = await db.from("rappi_stores").select("id, rappi_store_id")
    .eq("id", storeId).eq("connection_id", connection.id).eq("active", true)
    .maybeSingle<{ id: string; rappi_store_id: string }>();
  if (!store) throw new ErrorFuncion("RAPPI_STORE_NOT_FOUND", "La tienda no pertenece a esta conexión.", 404);
  const remote = await rappiRequestWithStatus(db, connection, "OPERATIONAL",
    `${PUBLIC_API}/menu/rappi/${encodeURIComponent(store.rappi_store_id)}`);
  if (remote.status < 200 || remote.status >= 300) throw new ErrorFuncion("MENU_RAPPI_NO_DISPONIBLE", "No pudimos comparar la carta de Rappi.", 502);
  const actual = itemsDeMenu(remote.body);
  const { productos, grupos, categorias } = await datosPublicacion(ctx);
  const propuesto = construirItems(productos, grupos, categorias);
  return {
    productos_actuales: actual.length, productos_propuestos: propuesto.length,
    respuestas_actuales: actual.reduce((n, item) => n + (Array.isArray(item.children) ? item.children.length : 0), 0),
    respuestas_propuestas: propuesto.reduce((n, item) => n + (item.children?.length ?? 0), 0),
    productos_retirados: actual.filter((item) => !propuesto.some((nuevo) => nuevo.sku === text(item.sku))).length,
  };
}

async function borrarCategoria(ctx: Contexto, body: Record<string, unknown>) {
  const id = uuid(body.id, "id");
  const db = ctx.clienteAdmin();
  const { count, error } = await db.from("rappi_menu_productos")
    .select("id", { count: "exact", head: true }).eq("empresa_id", ctx.empresaId).eq("categoria_id", id);
  if (error) throw errores.baseDeDatos(error.message);
  if (count) throw new ErrorFuncion("SECCION_CON_PRODUCTOS", "Mueve sus productos a otra sección antes de borrarla.", 409);
  return borrar(ctx, "rappi_menu_categorias", body);
}

/**
 * Reglas del catálogo de Rappi que rechazan un menú entero: nombre, SKU,
 * precio mayor que cero, categoría y máximo 50 opciones por producto.
 */
function validarItems(items: ReturnType<typeof construirItems>): void {
  if (items.length > 5_000) throw new ErrorFuncion("MENU_DEMASIADO_GRANDE", "El menú supera los 5.000 productos que acepta Rappi.", 400);
  for (const item of items) {
    if (!item.name || !item.sku) throw new ErrorFuncion("MENU_INVALIDO", "Hay un producto sin nombre.", 400);
    if (!(item.price > 0)) throw new ErrorFuncion("MENU_INVALIDO", `El producto "${item.name}" no tiene precio válido.`, 400);
    if (!item.category?.id || !item.category?.name) throw new ErrorFuncion("MENU_INVALIDO", `El producto "${item.name}" no tiene categoría.`, 400);
    if ((item.children?.length ?? 0) > 50) throw new ErrorFuncion("MENU_INVALIDO", `El producto "${item.name}" tiene más de 50 opciones.`, 400);
    for (const hijo of item.children ?? []) {
      if (!hijo.name || !hijo.sku) throw new ErrorFuncion("MENU_INVALIDO", `Una opción de "${item.name}" quedó sin nombre.`, 400);
      if (!(hijo.price >= 0)) throw new ErrorFuncion("MENU_INVALIDO", `Una opción de "${item.name}" tiene precio inválido.`, 400);
    }
  }
}

/** Rappi devuelve el motivo en errors[].reason o detail.error.code. */
function motivoRechazo(body: unknown): string | null {
  const raiz = (body ?? {}) as Record<string, unknown>;
  const listaErrores = Array.isArray(raiz.errors) ? raiz.errors as Record<string, unknown>[] : [];
  const razones = listaErrores.map((e) => text(e.reason)).filter(Boolean);
  if (razones.length) return `Rappi rechazó el menú: ${razones.slice(0, 3).join("; ")}`;
  const detalle = (raiz.detail ?? {}) as Record<string, unknown>;
  const codigo = text((detalle.error as Record<string, unknown>)?.code);
  if (codigo) return `Rappi rechazó el menú (${codigo}).`;
  const mensaje = text(raiz.message);
  return mensaje ? `Rappi rechazó el menú: ${mensaje}` : null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function actualizarHashLocal(ctx: Contexto): Promise<void> {
  const { productos, grupos, categorias } = await datosPublicacion(ctx);
  const hash = await sha256Hex(JSON.stringify(construirItems(productos, grupos, categorias)));
  const db = ctx.clienteAdmin();
  const { data: tiendas, error } = await db.from("rappi_stores").select("id")
    .eq("empresa_id", ctx.empresaId).eq("active", true);
  if (error) throw errores.baseDeDatos(error.message);
  for (const tienda of tiendas ?? []) {
    const { data: estado, error: lecturaError } = await db.from("rappi_menu_estado")
      .select("store_id").eq("empresa_id", ctx.empresaId).eq("store_id", tienda.id).maybeSingle();
    if (lecturaError) throw errores.baseDeDatos(lecturaError.message);
    const cambio = estado
      ? db.from("rappi_menu_estado").update({ hash_local: hash, actualizado_en: new Date().toISOString() })
        .eq("empresa_id", ctx.empresaId).eq("store_id", tienda.id)
      : db.from("rappi_menu_estado").insert({ empresa_id: ctx.empresaId, store_id: tienda.id, hash_local: hash });
    const { error: cambioError } = await cambio;
    if (cambioError) throw errores.baseDeDatos(cambioError.message);
  }
}

/**
 * Trae a Enkrato el menú que la tienda ya tiene en Rappi, para que el cliente
 * no tenga que reescribir su carta. Respeta lo que ya existe: un producto con
 * el mismo nombre no se duplica.
 */
async function importar(ctx: Contexto, body: Record<string, unknown>) {
  const storeId = uuid(body.store_id, "store_id");
  const environment = text(body.environment).toUpperCase() === "PROD" ? "PROD" : "DEV";
  const db = ctx.clienteAdmin();
  const { data: connection, error: connectionError } = await db.from("rappi_connections")
    .select("id, empresa_id, environment, status, operational_base_url, orders_base_url, financial_base_url, operational_enabled, financial_enabled")
    .eq("empresa_id", ctx.empresaId).eq("environment", environment).maybeSingle<RappiConnection>();
  if (connectionError) throw errores.baseDeDatos(connectionError.message);
  if (!connection) throw new ErrorFuncion("RAPPI_NOT_CONFIGURED", "Configura primero la conexión con Rappi.", 412);
  const { data: store, error: storeError } = await db.from("rappi_stores").select("id, rappi_store_id")
    .eq("id", storeId).eq("connection_id", connection.id).eq("active", true)
    .maybeSingle<{ id: string; rappi_store_id: string }>();
  if (storeError) throw errores.baseDeDatos(storeError.message);
  if (!store) throw new ErrorFuncion("RAPPI_STORE_NOT_FOUND", "La tienda no pertenece a esta conexión.", 404);

  const ruta = encodeURIComponent(store.rappi_store_id);
  const response = await rappiRequestWithStatus(db, connection, "OPERATIONAL", `${PUBLIC_API}/menu/rappi/${ruta}`);
  if (response.status < 200 || response.status >= 300) {
    throw new ErrorFuncion("MENU_RAPPI_NO_DISPONIBLE", motivoRechazo(response.body) || "Rappi no devolvió el menú.", 502);
  }
  const items = itemsDeMenu(response.body);
  if (!items.length) throw new ErrorFuncion("MENU_RAPPI_VACIO", "Rappi no devolvió una carta completa para esta tienda.", 404);
  for (const item of items) {
    if (!text(item.sku) || !text(item.name) || !Number.isFinite(Number(item.price)) ||
      !text((item.category as Record<string, unknown> | undefined)?.id)) {
      throw new ErrorFuncion("MENU_RAPPI_INVALIDO", "Rappi devolvió un producto incompleto; el menú local se conservó.", 502);
    }
  }
  const hash = await sha256Hex(JSON.stringify(items));
  const { data: estadoActual, error: errorEstado } = await db.from("rappi_menu_estado")
    .select("hash_local, hash_publicado, hash_pendiente")
    .eq("empresa_id", ctx.empresaId).eq("store_id", store.id).maybeSingle();
  if (errorEstado) throw errores.baseDeDatos(errorEstado.message);
  if (estadoActual?.hash_local === hash && estadoActual.hash_publicado === hash && !estadoActual.hash_pendiente) {
    return { estado: "sincronizado", importados: 0 };
  }
  const { data, error } = await db.rpc("rappi_menu_reemplazar", {
    p_empresa_id: ctx.empresaId, p_store_id: store.id, p_items: items,
    p_hash: hash, p_descartar_cambios: body.descartar_cambios === true,
  });
  if (error) throw errores.baseDeDatos(error.message);
  return data;
}

/** `GET menu/rappi/{storeId}` devuelve {storeId, items} o una lista de menús. */
function itemsDeMenu(body: unknown): Record<string, unknown>[] {
  const raiz = Array.isArray(body) ? body[0] : body;
  const items = (raiz as Record<string, unknown> | undefined)?.items;
  return Array.isArray(items) ? items as Record<string, unknown>[] : [];
}

/** `GET store/{id}/menu/current` usa products/toppings en vez de items/children. */
function productosDeMenuVigente(body: unknown): Record<string, unknown>[] {
  const raiz = Array.isArray(body) ? body[0] : body;
  const productos = (raiz as Record<string, unknown> | undefined)?.products;
  if (!Array.isArray(productos)) return [];
  return productos.map((producto) => {
    const fila = producto as Record<string, unknown>;
    return {
      name: fila.name,
      description: "",
      price: fila.price,
      children: Array.isArray(fila.toppings) ? fila.toppings : [],
    };
  });
}
