/**
 * Branding centralizado para toda la plataforma.
 * Cambiar aquí cuando se actualice nombre comercial o firma legal.
 */
export const BRAND = Object.freeze({
  platformName: "Enkrato",
  legalSignature: "Enkrato by Global Nexo Shop S.A.S",
  logoAlt: "Logo Enkrato"
});

export const applyBrandingToDocumentTitle = () => {
  if (typeof document === "undefined") return;
  const current = String(document.title || "").trim();
  if (!current) {
    document.title = BRAND.platformName;
    return;
  }

  const normalized = current
    .replace(/^AXIOMA-tech\s*\|\s*/i, "")
    .replace(/^AXIOMA\s*\|\s*/i, "")
    .replace(/^Enkrato\s*\|\s*/i, "");

  document.title = `${BRAND.platformName} | ${normalized}`;
};
