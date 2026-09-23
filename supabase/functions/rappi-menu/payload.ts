export type MenuCategory = {
  id: string; nombre: string; orden: number; rappi_category_id?: string | null;
};
export type MenuProduct = {
  id: string; sku: string; rappi_sku?: string | null; nombre: string;
  descripcion: string; precio: number; imagen_path: string | null;
  rappi_image_url?: string | null;
  categoria_id: string | null; orden: number;
};
export type MenuOption = {
  id: string; grupo_id: string; sku: string; rappi_sku?: string | null;
  nombre: string; descripcion?: string | null; precio: number; orden: number; max_limit?: number;
};
export type MenuLink = { producto_id: string; orden: number; min_qty?: number | null; max_qty?: number | null };
export type MenuGroup = {
  id: string; nombre: string; orden: number; min_qty: number; max_qty: number;
  rappi_group_id?: string | null; opciones: MenuOption[]; enlaces: MenuLink[];
};

export const menuSlug = (value: string): string => value.normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toUpperCase()
  .replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "MENU";

/** Construye el contrato del envío aprobado; no agrega campos internos de Rappi. */
export function buildRappiItems(
  products: MenuProduct[], groups: MenuGroup[], categories: MenuCategory[],
  imageUrl: (path: string | null) => string | null = () => null,
) {
  const sortedCategories = [...categories].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  const categoryById = new Map(sortedCategories.map((category, index) => [category.id, {
    id: category.rappi_category_id || `SEC-${menuSlug(category.nombre)}-${category.id.slice(0, 8)}`,
    name: category.nombre,
    sortingPosition: index + 1,
  }]));
  const sortedProducts = [...products].sort((a, b) => {
    const categoryA = categoryById.get(a.categoria_id || "")?.sortingPosition ?? 9999;
    const categoryB = categoryById.get(b.categoria_id || "")?.sortingPosition ?? 9999;
    return categoryA - categoryB || a.orden - b.orden || a.nombre.localeCompare(b.nombre);
  });
  const positionByCategory = new Map<string, number>();

  return sortedProducts.map((product) => {
    const categoryKey = product.categoria_id || "general";
    const position = (positionByCategory.get(categoryKey) || 0) + 1;
    positionByCategory.set(categoryKey, position);
    const productSku = product.rappi_sku || product.sku;
    const category = categoryById.get(product.categoria_id || "") || {
      id: "SEC-GENERAL", name: "General", sortingPosition: sortedCategories.length + 1,
    };
    const linked = groups.flatMap((group) => {
      const link = group.enlaces.find((item) => item.producto_id === product.id);
      return link ? [{ group, link }] : [];
    }).sort((a, b) => a.link.orden - b.link.orden || a.group.orden - b.group.orden);
    const children = linked.flatMap(({ group, link }, groupIndex) => {
      const options = [...group.opciones].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
      const groupId = group.rappi_group_id && group.enlaces.length === 1
        ? group.rappi_group_id
        : `${productSku}-${menuSlug(group.nombre)}-${group.id.slice(0, 6)}`;
      return options.map((option, optionIndex) => ({
        name: option.nombre,
        description: option.descripcion ?? option.nombre,
        price: Number(option.precio),
        sku: group.enlaces.length === 1 && option.rappi_sku ? option.rappi_sku : `${productSku}-${option.sku}`,
        type: "TOPPING",
        sortingPosition: optionIndex + 1,
        maxLimit: Math.max(1, Number(option.max_limit) || 1),
        category: {
          id: groupId,
          name: group.nombre,
          minQty: Number(link.min_qty ?? group.min_qty),
          maxQty: Number(link.max_qty ?? group.max_qty),
          sortingPosition: groupIndex + 1,
        },
      }));
    });
    const image = product.rappi_image_url || imageUrl(product.imagen_path);
    return {
      name: product.nombre,
      description: product.descripcion || "",
      price: Number(product.precio),
      sku: productSku,
      type: "PRODUCT",
      sortingPosition: position,
      category,
      ...(image ? { imageUrl: image } : {}),
      ...(children.length ? { children } : {}),
    };
  });
}
