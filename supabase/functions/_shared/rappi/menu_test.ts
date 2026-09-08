import { validateRappiMenuItems } from "./menu.ts";

function assertThrows(callback: () => void, message: string): void {
  let thrown = false;
  try { callback(); } catch { thrown = true; }
  if (!thrown) throw new Error(message);
}

const validItem = {
  name: "Hamburguesa",
  sku: "BURGER-1",
  type: "PRODUCT",
  price: 18000,
  category: { id: "BURGERS", name: "Hamburguesas", minQty: 0, maxQty: 0, sortingPosition: 0 },
  children: [],
};

Deno.test("Rappi menu validator accepts a valid DEV menu", () => {
  validateRappiMenuItems([validItem]);
});

Deno.test("Rappi menu validator rejects missing required business fields", () => {
  assertThrows(() => validateRappiMenuItems([{ ...validItem, sku: "" }]), "Missing SKU should fail");
  assertThrows(() => validateRappiMenuItems([{ ...validItem, price: null }]), "Missing price should fail");
  assertThrows(() => validateRappiMenuItems([{ ...validItem, type: "UNKNOWN" }]), "Invalid type should fail");
});

Deno.test("Rappi menu validator enforces provider child limits", () => {
  assertThrows(
    () => validateRappiMenuItems([{ ...validItem, children: Array.from({ length: 51 }, () => validItem) }]),
    "More than 50 options should fail",
  );
});
