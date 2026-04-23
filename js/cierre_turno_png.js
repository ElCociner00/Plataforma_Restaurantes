/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/cierre_turno_png.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - `getSnapshotRows` (línea aprox. 1): Obtiene un valor o recurso.
 * - `drawHeader` (línea aprox. 92): Bloque funcional del módulo.
 * - `drawHighlightedCards` (línea aprox. 131): Bloque funcional del módulo.
 * - `buildCanvas` (línea aprox. 169): Construye estructuras de datos.
 * - `drawRow` (línea aprox. 185): Bloque funcional del módulo.
 * - `drawGasto` (línea aprox. 225): Bloque funcional del módulo.
 * - `drawTotal` (línea aprox. 258): Bloque funcional del módulo.
 * - `drawApoyo` (línea aprox. 301): Bloque funcional del módulo.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */
const getSnapshotRows = ({
  snapshotContext
}) => {
  const {
    inputsFinanzas,
    inputsDiferencias,
    inputsSoloVista,
    bolsa,
    caja,
    extrasRows,
    apoyoRowsContainer,
    responsablesActivos,
    readApoyoRange,
    formatDurationLabel,
    getTotalIngresosSistema,
    getTotalIngresosReales,
    getTotalGastosExtras
  } = snapshotContext;

  const finanzas = [
    ["Efectivo", inputsFinanzas.efectivo.sistema.value, inputsFinanzas.efectivo.real.value, inputsDiferencias.efectivo.input.value],
    ["Datáfono", inputsFinanzas.datafono.sistema.value, inputsFinanzas.datafono.real.value, inputsDiferencias.datafono.input.value],
    ["Rappi", inputsFinanzas.rappi.sistema.value, inputsFinanzas.rappi.real.value, inputsDiferencias.rappi.input.value],
    ["Nequi", inputsFinanzas.nequi.sistema.value, inputsFinanzas.nequi.real.value, inputsDiferencias.nequi.input.value],
    ["Transferencias", inputsFinanzas.transferencias.sistema.value, inputsFinanzas.transferencias.real.value, inputsDiferencias.transferencias.input.value],
    ["Bono regalo", inputsFinanzas.bono_regalo.sistema.value, inputsFinanzas.bono_regalo.real.value, inputsDiferencias.bono_regalo.input.value],
    ["Propina", inputsSoloVista.propina.value, "-", "-"],
    ["Domicilios", inputsSoloVista.domicilios.value, "-", "-"],
    ["Bolsa", "-", bolsa?.value || "0", "-"],
    ["Caja", "-", caja?.value || "0", "-"]
  ];

  const gastos = Array.from(extrasRows.values())
    .filter((row) => row.visible)
    .map((row) => [row.nombre || "Gasto", row.input?.value || row.value || "0"]);

  const totalSistema = getTotalIngresosSistema();
  const totalReal = getTotalIngresosReales();
  const totalGastos = getTotalGastosExtras();
  const ventaBruta = totalReal;
  const ventaNeta = totalReal - totalGastos;
  const diferenciaGeneral = totalReal - totalSistema;

  const totales = [
    ["Total ingresos sistema", totalSistema],
    ["Total ventas", totalReal],
    ["Total gastos", totalGastos],
    ["Venta bruta (sin gastos)", ventaBruta],
    ["Venta neta (después de gastos)", ventaNeta],
    ["Diferencia general", diferenciaGeneral]
  ];

  const apoyos = Array.from(apoyoRowsContainer?.querySelectorAll(".apoyo-row") || []).map((row) => {
    const apoyoResponsableId = row.querySelector('[data-field="responsable"]')?.value || "";
    const apoyoResponsableNombre = responsablesActivos.find((item) => String(item?.id || "") === apoyoResponsableId)?.nombre_completo || apoyoResponsableId || "-";
    const propinaValue = row.querySelector('[data-field="propina"]')?.value || "0";
    const range = readApoyoRange(row);
    const tiempoMinutes = range.complete ? Number(range.durationMinutes || 0) : 0;
    return {
      responsable: apoyoResponsableNombre,
      propina: propinaValue,
      tiempo_minutos: tiempoMinutes,
      tiempo_texto: range.complete ? range.durationText : formatDurationLabel(tiempoMinutes)
    };
  });

  return { finanzas, gastos, totales, apoyos };
};

export const descargarImagenResumenCierreTurno = ({
  snapshotContext,
  meta,
  formatCOP,
  setStatus
}) => {
  const { finanzas, gastos, totales, apoyos } = getSnapshotRows({ snapshotContext });

  const marcaAxioma = "AXIOMA by Global Nexo Shop";
  const fechaExpedicion = new Date().toLocaleDateString("es-CO");
  const fechaNombre = (meta.fecha || new Date().toISOString().slice(0, 10));

  // Obtener propina del responsable (primer apoyo o valor separado)
  const propinaResponsable = snapshotContext.inputsSoloVista?.propina?.value || "0";
  
  // Agregar responsable a la lista de apoyos con su propina
  const responsableRow = {
    responsable: meta.responsableTexto || "Responsable",
    propina: propinaResponsable,
    tiempo_texto: `${meta.horaInicio || "00:00"} - ${meta.horaFin || "00:00"}`,
    es_responsable: true
  };
  
  const apoyosConResponsable = [responsableRow, ...apoyos];

  const PAGE_WIDTH = 1080;
  const PAGE_HEIGHT = 1920;
  const cardX = 46;
  const cardY = 46;
  const cardW = PAGE_WIDTH - 92;
  const cardH = PAGE_HEIGHT - 92;
  const tableX = cardX + 32;
  const tableW = cardW - 64;
  const rowH = 42;

  const drawHeader = (ctx, pageNumber, totalPages) => {
    ctx.fillStyle = "#f3edff";
    ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#b8a6f8";
    ctx.lineWidth = 4;
    ctx.fillRect(cardX, cardY, cardW, cardH);
    ctx.strokeRect(cardX, cardY, cardW, cardH);

    let y = cardY + 54;
    ctx.fillStyle = "#4c1d95";
    ctx.font = "bold 44px Arial";
    ctx.fillText("CIERRE DE TURNO", cardX + 36, y);

    ctx.textAlign = "right";
    ctx.fillStyle = "#312e81";
    ctx.font = "bold 34px Arial";
    ctx.fillText(meta.empresaNombre, cardX + cardW - 36, y);
    ctx.font = "bold 20px Arial";
    ctx.fillStyle = "#6d28d9";
    ctx.fillText(marcaAxioma, cardX + cardW - 36, y + 34);
    ctx.textAlign = "left";

    y += 48;
    ctx.fillStyle = "#3f3f46";
    ctx.font = "28px Arial";
    ctx.fillText(`Fecha: ${meta.fecha || "-"}`, cardX + 36, y);
    y += 40;
    ctx.fillText(`Responsable: ${meta.responsableTexto}`, cardX + 36, y);
    y += 40;
    ctx.fillText(`Hora llegada: ${meta.horaLlegada}`, cardX + 36, y);
    y += 40;
    ctx.fillText(`Inicio/Fin: ${meta.horaInicio} / ${meta.horaFin}`, cardX + 36, y);
    y += 20;
    ctx.fillStyle = "#7c3aed";
    ctx.font = "bold 18px Arial";
    ctx.fillText(`Página ${pageNumber} de ${totalPages}`, cardX + 36, y);
  };

  const drawHighlightedCards = (ctx) => {
    let startY = cardY + 260;
    const spacing = 48;
    
    // Efectivo apertura (separado)
    ctx.fillStyle = "#5b21b6";
    ctx.font = "bold 22px Arial";
    ctx.fillText("Efectivo apertura:", tableX + 10, startY);
    ctx.fillStyle = "#312e81";
    ctx.font = "bold 22px Arial";
    ctx.fillText(formatCOP(meta.efectivoApertura || 0), tableX + 280, startY);
    startY += spacing;
    
    // Bolsa y Caja (juntos pero separados)
    ctx.fillStyle = "#5b21b6";
    ctx.font = "bold 22px Arial";
    ctx.fillText("Bolsa:", tableX + 10, startY);
    ctx.fillStyle = "#312e81";
    ctx.font = "bold 22px Arial";
    ctx.fillText(formatCOP(meta.bolsa || 0), tableX + 150, startY);
    
    ctx.fillStyle = "#5b21b6";
    ctx.font = "bold 22px Arial";
    ctx.fillText("Caja:", tableX + 350, startY);
    ctx.fillStyle = "#312e81";
    ctx.font = "bold 22px Arial";
    ctx.fillText(formatCOP(meta.caja || 0), tableX + 490, startY);
    startY += spacing;
    
    // Total ventas (sin efectivo apertura)
    ctx.fillStyle = "#5b21b6";
    ctx.font = "bold 22px Arial";
    ctx.fillText("Total ventas (sin efectivo apertura):", tableX + 10, startY);
    ctx.fillStyle = "#9b4d96";
    ctx.font = "bold 26px Arial";
    ctx.fillText(formatCOP(snapshotContext.getTotalIngresosReales()), tableX + 470, startY);
    startY += spacing + 20;
    
    return startY;
  };

  const buildCanvas = (pageApoyos = [], pageNumber = 1, totalPages = 1, isApoyoContinuation = false) => {
    const canvas = document.createElement("canvas");
    canvas.width = PAGE_WIDTH;
    canvas.height = PAGE_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    drawHeader(ctx, pageNumber, totalPages);
    let y = drawHighlightedCards(ctx);

    ctx.fillStyle = "#5b21b6";
    ctx.font = "bold 30px Arial";
    ctx.fillText("Datos financieros del turno", cardX + 36, y);
    y += 34;
    
    const colW = [0.36, 0.22, 0.22, 0.2].map((r) => Math.floor(tableW * r));

    const drawRow = (rowY, cols, header = false) => {
      let x = tableX;
      ctx.strokeStyle = "#d8ccff";
      ctx.lineWidth = 1;
      ctx.fillStyle = header ? "#ede9fe" : "#ffffff";
      ctx.fillRect(tableX, rowY, tableW, rowH);
      ctx.strokeRect(tableX, rowY, tableW, rowH);
      cols.forEach((col, i) => {
        if (i > 0) {
          ctx.beginPath();
          ctx.moveTo(x, rowY);
          ctx.lineTo(x, rowY + rowH);
          ctx.stroke();
        }
        ctx.fillStyle = "#27272a";
        ctx.font = header ? "bold 20px Arial" : "19px Arial";
        ctx.fillText(String(col), x + 8, rowY + 27);
        x += colW[i];
      });
    };

    drawRow(y + 14, ["Dato", "Sistema", "Real", "Diferencia"], true);
    let tableY = y + 14 + rowH;
    finanzas.forEach((row) => {
      drawRow(tableY, [
        row[0],
        row[1] === "-" ? "-" : formatCOP(row[1]),
        row[2] === "-" ? "-" : formatCOP(row[2]),
        row[3] === "-" ? "-" : formatCOP(row[3])
      ]);
      tableY += rowH;
    });

    y = tableY + 40;
    ctx.fillStyle = "#5b21b6";
    ctx.font = "bold 30px Arial";
    ctx.fillText("Gastos", cardX + 36, y);

    y += 16;
    const gastosCols = [0.7, 0.3].map((r) => Math.floor(tableW * r));
    const drawGasto = (rowY, cols, header = false) => {
      let x = tableX;
      ctx.fillStyle = header ? "#ede9fe" : "#ffffff";
      ctx.fillRect(tableX, rowY, tableW, rowH);
      ctx.strokeRect(tableX, rowY, tableW, rowH);
      cols.forEach((col, i) => {
        if (i > 0) {
          ctx.beginPath();
          ctx.moveTo(x, rowY);
          ctx.lineTo(x, rowY + rowH);
          ctx.stroke();
        }
        ctx.fillStyle = "#27272a";
        ctx.font = header ? "bold 20px Arial" : "19px Arial";
        ctx.fillText(String(col), x + 8, rowY + 27);
        x += gastosCols[i];
      });
    };

    drawGasto(y + 14, ["Gasto", "Valor"], true);
    let gastoY = y + 14 + rowH;
    (gastos.length ? gastos : [["Sin gastos", "0"]]).forEach(([name, value]) => {
      drawGasto(gastoY, [name, formatCOP(value)]);
      gastoY += rowH;
    });

    gastoY += 26;
    ctx.fillStyle = "#5b21b6";
    ctx.font = "bold 30px Arial";
    ctx.fillText("Totales del turno", cardX + 36, gastoY);

    gastoY += 20;
    const totalCols = [0.65, 0.35].map((r) => Math.floor(tableW * r));
    const drawTotal = (rowY, label, value, highlight = false) => {
      let x = tableX;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(tableX, rowY, tableW, rowH);
      ctx.strokeRect(tableX, rowY, tableW, rowH);

      [label, value].forEach((col, i) => {
        if (i > 0) {
          ctx.beginPath();
          ctx.moveTo(x, rowY);
          ctx.lineTo(x, rowY + rowH);
          ctx.stroke();
        }

        if (i === 0) {
          ctx.textAlign = "left";
          ctx.fillStyle = "#27272a";
          ctx.font = "20px Arial";
          ctx.fillText(String(col), x + 10, rowY + 27);
        } else {
          ctx.textAlign = "right";
          ctx.fillStyle = highlight ? "#4c1d95" : "#312e81";
          ctx.font = highlight ? "bold 20px Arial" : "20px Arial";
          ctx.fillText(String(col), x + totalCols[i] - 10, rowY + 27);
        }
        x += totalCols[i];
      });
      ctx.textAlign = "left";
    };

    totales.forEach(([label, value], idx) => {
      drawTotal(gastoY, label, formatCOP(value), idx === totales.length - 1);
      gastoY += rowH;
    });

    if (isApoyoContinuation || pageApoyos.length) {
      let apoyoY = gastoY + 26;
      ctx.fillStyle = "#5b21b6";
      ctx.font = "bold 30px Arial";
      ctx.fillText(isApoyoContinuation ? "Apoyos y propinas (continuación)" : "Apoyos y propinas", cardX + 36, apoyoY);
      apoyoY += 16;

      const apoyoCols = [0.45, 0.2, 0.35].map((r) => Math.floor(tableW * r));
      const drawApoyo = (rowY, cols, header = false, isResponsable = false) => {
        let x = tableX;
        ctx.fillStyle = header ? "#ede9fe" : (isResponsable ? "#fae8ff" : "#ffffff");
        ctx.fillRect(tableX, rowY, tableW, rowH);
        ctx.strokeRect(tableX, rowY, tableW, rowH);
        cols.forEach((col, i) => {
          if (i > 0) {
            ctx.beginPath();
            ctx.moveTo(x, rowY);
            ctx.lineTo(x, rowY + rowH);
            ctx.stroke();
          }
          ctx.fillStyle = isResponsable ? "#9b4d96" : "#27272a";
          ctx.font = header ? "bold 19px Arial" : "18px Arial";
          ctx.fillText(String(col), x + 8, rowY + 27);
          x += apoyoCols[i];
        });
      };

      drawApoyo(apoyoY + 14, ["Responsable / Apoyo", "Propina", "Tiempo / Rango"], true);
      let rowY = apoyoY + 14 + rowH;
      (pageApoyos.length ? pageApoyos : [["Sin apoyos", "0", "-"]]).forEach((item) => {
        const cols = Array.isArray(item)
          ? item
          : [
            item.responsable || "-",
            typeof item.propina === "string" ? item.propina : formatCOP(item.propina || 0),
            item.tiempo_texto || "-"
          ];
        drawApoyo(rowY, cols, false, item?.es_responsable === true);
        rowY += rowH;
      });
    }

    const selloY = cardY + cardH - 30;
    ctx.textAlign = "center";
    ctx.fillStyle = "#4338ca";
    ctx.font = "bold 20px Arial";
    ctx.fillText(`Expedido por AXIOMA by Global Nexo Shop (${fechaExpedicion})`, cardX + (cardW / 2), selloY);
    ctx.textAlign = "left";
    return canvas;
  };

  const firstPageMax = 6;
  const continuationMax = 18;
  const pagesApoyos = [];
  const apoyoItems = Array.isArray(apoyosConResponsable) ? apoyosConResponsable : [];
  if (!apoyoItems.length) {
    pagesApoyos.push([{
      responsable: "Turno culminado sin apoyos",
      propina: "-",
      tiempo_texto: "-"
    }]);
  } else {
    pagesApoyos.push(apoyoItems.slice(0, firstPageMax));
    let offset = firstPageMax;
    while (offset < apoyoItems.length) {
      pagesApoyos.push(apoyoItems.slice(offset, offset + continuationMax));
      offset += continuationMax;
    }
  }

  const canvases = pagesApoyos.map((slice, idx) => buildCanvas(slice, idx + 1, pagesApoyos.length, idx > 0)).filter(Boolean);
  if (!canvases.length) {
    setStatus("No se pudo generar la imagen del resumen.");
    return false;
  }

  canvases.forEach((canvas, idx) => {
    const link = document.createElement("a");
    const suffix = canvases.length > 1 ? `_p${idx + 1}` : "";
    link.download = `cierre_turno_${fechaNombre}${suffix}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  });

  return true;
};
