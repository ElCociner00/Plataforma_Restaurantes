import { BRAND } from "./branding.js";

export const drawPngBrandWatermark = (ctx, {
  canvasWidth,
  canvasHeight,
  empresaNombre = "Empresa",
  moduloNombre = "Módulo",
  fechaTexto = "-"
} = {}) => {
  if (!ctx) return;

  ctx.save();
  ctx.fillStyle = "rgba(17, 24, 39, 0.06)";
  ctx.font = "bold 64px Arial";
  ctx.textAlign = "center";
  ctx.fillText(BRAND.platformName.toUpperCase(), canvasWidth / 2, canvasHeight / 2);

  const infoX = canvasWidth - 70;
  let infoY = 72;
  ctx.fillStyle = "#6b7280";
  ctx.textAlign = "right";
  ctx.font = "bold 24px Arial";
  ctx.fillText(empresaNombre, infoX, infoY);

  infoY += 30;
  ctx.font = "20px Arial";
  ctx.fillText(moduloNombre, infoX, infoY);

  infoY += 30;
  ctx.fillText(`Fecha: ${fechaTexto}`, infoX, infoY);

  ctx.fillStyle = "#9ca3af";
  ctx.font = "16px Arial";
  ctx.textAlign = "center";
  ctx.fillText(BRAND.legalSignature, canvasWidth / 2, canvasHeight - 20);
  ctx.restore();
};
