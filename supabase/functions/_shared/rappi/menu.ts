import { ErrorFuncion } from "../errores.ts";
import { record, text } from "./payload.ts";

export function validateRappiMenuItems(items: unknown[], depth = 0): void {
  if (!items.length) throw new ErrorFuncion("RAPPI_MENU_EMPTY", "El menú debe contener al menos un producto.", 400);
  if (items.length > 5_000) throw new ErrorFuncion("RAPPI_MENU_ITEMS", "El menú contiene demasiados productos.", 400);
  if (depth > 11) throw new ErrorFuncion("RAPPI_MENU_DEPTH", "El menú supera la profundidad permitida.", 400);
  for (const value of items) {
    const item = record(value);
    const type = text(item.type).toUpperCase();
    const category = record(item.category);
    const hasPrice = item.price !== null && item.price !== undefined && item.price !== "";
    if (!text(item.name) || !text(item.sku) || !["PRODUCT", "TOPPING"].includes(type)) {
      throw new ErrorFuncion("RAPPI_MENU_STRUCTURE", "Cada producto debe incluir nombre, SKU y tipo válido.", 400);
    }
    if (!hasPrice || !Number.isFinite(Number(item.price)) || !text(category.id) || !text(category.name)) {
      throw new ErrorFuncion("RAPPI_MENU_STRUCTURE", "Cada producto debe incluir precio y categoría válidos.", 400);
    }
    const children = Array.isArray(item.children) ? item.children : [];
    if (children.length > 50) throw new ErrorFuncion("RAPPI_MENU_CHILDREN", "Un producto contiene demasiadas opciones.", 400);
    if (children.length) validateRappiMenuItems(children, depth + 1);
  }
}
