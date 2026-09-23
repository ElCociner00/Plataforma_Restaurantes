import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildRappiItems } from "../supabase/functions/rappi-menu/payload.ts";

const source = JSON.parse(await readFile(new URL("../docs/documentos_para_pruebas/2026-09-17_menu_rappi_batut_aprobado.json", import.meta.url), "utf8"));
const categories = [];
const products = [];
const groups = [];
const categoryByExternal = new Map();
for (const [productIndex, item] of source.items.entries()) {
  if (!categoryByExternal.has(item.category.id)) {
    const category = {
      id: `category-${categoryByExternal.size}`, nombre: item.category.name,
      orden: item.category.sortingPosition, rappi_category_id: item.category.id,
    };
    categoryByExternal.set(item.category.id, category);
    categories.push(category);
  }
  const productId = `product-${productIndex}`;
  products.push({
    id: productId, sku: `local-${productIndex}`, rappi_sku: item.sku,
    nombre: item.name, descripcion: item.description, precio: item.price,
    imagen_path: null, categoria_id: categoryByExternal.get(item.category.id).id,
    orden: item.sortingPosition,
  });
  const groupsByExternal = new Map();
  for (const child of item.children ?? []) {
    let group = groupsByExternal.get(child.category.id);
    if (!group) {
      group = {
        id: `group-${groups.length}`, nombre: child.category.name,
        orden: child.category.sortingPosition, min_qty: child.category.minQty,
        max_qty: child.category.maxQty, rappi_group_id: child.category.id,
        opciones: [], enlaces: [{ producto_id: productId, orden: child.category.sortingPosition, min_qty: child.category.minQty, max_qty: child.category.maxQty }],
      };
      groupsByExternal.set(child.category.id, group);
      groups.push(group);
    }
    group.opciones.push({
      id: `option-${productIndex}-${group.opciones.length}`, grupo_id: group.id,
      sku: `local-option-${group.opciones.length}`, rappi_sku: child.sku,
      nombre: child.name, descripcion: child.description, precio: child.price, orden: child.sortingPosition,
      max_limit: child.maxLimit,
    });
  }
}

const actual = buildRappiItems(products, groups, categories);
assert.equal(actual.length, 50);
assert.equal(actual.flatMap((product) => product.children ?? []).length, 473);
function firstMismatch(expected, received, path = "items") {
  if (typeof expected !== typeof received || Array.isArray(expected) !== Array.isArray(received)) return path;
  if (expected === null || received === null || typeof expected !== "object") return expected === received ? null : path;
  const expectedKeys = Object.keys(expected).sort();
  const receivedKeys = Object.keys(received).sort();
  if (expectedKeys.join("|") !== receivedKeys.join("|")) return `${path} keys`;
  for (const key of expectedKeys) {
    const mismatch = firstMismatch(expected[key], received[key], `${path}.${key}`);
    if (mismatch) return mismatch;
  }
  return null;
}
const mismatch = firstMismatch(source.items, actual);
assert.equal(mismatch, null, `El payload reconstruido difiere en ${mismatch}`);
console.log("Rappi menú OK: 50 productos, 473 opciones y comparación campo por campo con el JSON aprobado.");
