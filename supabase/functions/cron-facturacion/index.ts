/**
 * cron-facturacion — el ciclo diario de cobro.
 *
 * Contexto: docs/2026-08-24_plan_facturacion_multitenant.md §7 Fase 4.
 *
 * Lo dispara pg_cron todos los días. El trabajo de base lo hace el RPC
 * facturacion_ciclo_diario(); esta función existe para lo que SQL no puede
 * hacer: enviar los correos.
 *
 *   día 25        emite la factura del mes y la envía
 *   días 1 y 4    recuerda que quedan días de gracia
 *   día 6         marca vencida y avisa — SIN restringir a nadie
 *
 * IMPORTANTE (§1.4 del plan): esta función no bloquea ni desactiva nada. El
 * RPC anota en billing_observaciones a quién habría restringido, y ahí se
 * queda hasta que Andrés autorice encender el corte.
 *
 * No la llama el navegador: se autentica con x-cron-secret, igual que
 * cron-refrescar-token-loggro.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { enviarCorreo, plantilla, proveedorConfigurado } from "../_shared/correo.ts";

const ETIQUETA = "cron-facturacion";

const URL_FACTURACION = Deno.env.get("WOMPI_REDIRECT_URL")
  ?? "https://restaurantes.enkrato.com/facturacion/";

const pesos = (v: unknown) =>
  Number(v ?? 0).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

const fecha = (v: unknown) => {
  const [a, m, d] = String(v ?? "").split("-").map(Number);
  if (!a || !m || !d) return "—";
  return new Date(a, m - 1, d).toLocaleDateString("es-CO", { day: "2-digit", month: "long", year: "numeric" });
};

const boton = `
  <p style="margin:24px 0">
    <a href="${URL_FACTURACION}"
       style="background:#111;color:#fff;padding:12px 22px;border-radius:8px;
              text-decoration:none;display:inline-block;font-weight:600">
      Pagar en línea
    </a>
  </p>
  <p style="font-size:13px;color:#666">
    Puedes pagar con tarjeta de crédito o débito, PSE, Nequi o Bancolombia.
    Tu factura queda marcada como pagada automáticamente.
  </p>`;

type Aviso = Record<string, unknown>;

/* ── Correos del ciclo de vida (alta y baja) ─────────────────────────────── */

function correoActivacionPendiente(a: Aviso): { asunto: string; html: string } {
  const dias = Number(a.dias_restantes ?? 0);
  return {
    asunto: dias <= 3
      ? `Te quedan ${dias} días para activar tu prueba de AXIOMA`
      : "Tu prueba gratuita de AXIOMA sigue esperándote",
    html: plantilla("Activa tu prueba gratuita", `
      <p>Hola, ${a.cuenta}:</p>
      <p>Todavía no has activado tus <strong>15 días de prueba gratuita</strong>.
         Recuerda que el tiempo empieza a contar cuando tú la actives, no antes.</p>
      <p>Tienes hasta el <strong>${fecha(a.activacion_limite)}</strong>
         — te ${dias === 1 ? "queda" : "quedan"} <strong>${dias} día${dias === 1 ? "" : "s"}</strong>.</p>
      ${boton}`),
  };
}

function correoBloqueada(a: Aviso): { asunto: string; html: string } {
  return {
    asunto: "Tu cuenta de AXIOMA quedó en pausa",
    html: plantilla("Cuenta en pausa", `
      <p>Hola, ${a.cuenta}:</p>
      <p>El plazo para activar tu prueba venció el
         <strong>${fecha(a.activacion_limite)}</strong>, así que tu cuenta quedó
         en pausa.</p>
      <p>No has perdido nada: escríbenos respondiendo a este correo y la
         reabrimos enseguida, con un plazo nuevo.</p>
      ${boton}`),
  };
}



function correoEmitida(a: Aviso): { asunto: string; html: string } {
  return {
    asunto: `Tu factura ${a.numero} de AXIOMA — ${pesos(a.total)}`,
    html: plantilla("Tu factura del mes", `
      <p>Hola, ${a.cuenta}:</p>
      <p>Ya está lista tu factura <strong>${a.numero}</strong> por el periodo
         del ${fecha(a.periodo_desde)} al ${fecha(a.periodo_hasta)}.</p>
      <p style="font-size:22px;margin:18px 0"><strong>${pesos(a.total)}</strong></p>
      <p>Tienes hasta el <strong>${fecha(a.fecha_limite_pago)}</strong> para pagarla.</p>
      ${boton}`),
  };
}

function correoRecordatorio(a: Aviso): { asunto: string; html: string } {
  const dias = Number(a.dias_restantes ?? 0);
  return {
    asunto: `Recordatorio: tu factura ${a.numero} vence el ${fecha(a.fecha_limite_pago)}`,
    html: plantilla("Te quedan días de gracia", `
      <p>Hola, ${a.cuenta}:</p>
      <p>Tu factura <strong>${a.numero}</strong> por <strong>${pesos(a.total)}</strong>
         sigue pendiente.</p>
      <p>Te ${dias === 1 ? "queda" : "quedan"} <strong>${dias} día${dias === 1 ? "" : "s"}</strong>
         para pagarla sin contratiempos: el plazo termina el
         <strong>${fecha(a.fecha_limite_pago)}</strong>.</p>
      ${boton}`),
  };
}

function correoVencida(a: Aviso): { asunto: string; html: string } {
  return {
    asunto: `Tu factura ${a.numero} está vencida`,
    html: plantilla("Factura vencida", `
      <p>Hola, ${a.cuenta}:</p>
      <p>Tu factura <strong>${a.numero}</strong> por <strong>${pesos(a.total)}</strong>
         venció el ${fecha(a.fecha_limite_pago)}.</p>
      <p>Tu servicio sigue funcionando con normalidad. Cuando puedas, ponte al día
         desde la plataforma.</p>
      ${boton}`),
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const responder = (cuerpo: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(cuerpo), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });

  const secreto = Deno.env.get("CRON_SECRET");
  if (!secreto) {
    console.error(`[${ETIQUETA}] CRON_SECRET no está configurado.`);
    return responder({ ok: false, message: "Función no configurada." }, 500);
  }
  if (req.headers.get("x-cron-secret") !== secreto) {
    return responder({ ok: false, message: "No autorizado." }, 401);
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Permite forzar un día concreto para probar el ciclo sin esperar al 25.
  let diaForzado: number | null = null;
  try {
    const cuerpo = await req.json();
    if (cuerpo && typeof cuerpo.dia === "number") diaForzado = cuerpo.dia;
  } catch { /* cuerpo vacío: lo normal desde pg_cron */ }

  const { data, error } = await db.rpc("facturacion_ciclo_diario", { p_forzar_dia: diaForzado });

  if (error) {
    console.error(`[${ETIQUETA}] facturacion_ciclo_diario falló:`, error.message);
    return responder({ ok: false, message: "Error en el ciclo de facturación." }, 500);
  }

  // El ciclo de vida va aparte: uno cobra, el otro vigila el alta. Que falle
  // uno no debe impedir el otro.
  const { data: vida, error: errorVida } = await db.rpc("ciclo_vida_diario");
  if (errorVida) {
    console.error(`[${ETIQUETA}] ciclo_vida_diario falló:`, errorVida.message);
  }

  const resultado = data as Record<string, Aviso[]>;
  const cicloVida = (vida ?? {}) as Record<string, Aviso[]>;
  const correos: { para: string; asunto: string; html: string }[] = [];

  for (const a of cicloVida.avisos_activacion ?? []) {
    if (a.correo) correos.push({ para: String(a.correo), ...correoActivacionPendiente(a) });
  }
  for (const a of cicloVida.bloqueadas ?? []) {
    if (a.correo) correos.push({ para: String(a.correo), ...correoBloqueada(a) });
  }

  for (const a of resultado.emitidas ?? []) {
    if (a.correo) correos.push({ para: String(a.correo), ...correoEmitida(a) });
  }
  for (const a of resultado.recordatorios ?? []) {
    if (a.correo) correos.push({ para: String(a.correo), ...correoRecordatorio(a) });
  }
  for (const a of resultado.vencidas ?? []) {
    if (a.correo) correos.push({ para: String(a.correo), ...correoVencida(a) });
  }

  let enviados = 0;
  let fallidos = 0;

  if (correos.length && !proveedorConfigurado()) {
    console.warn(`[${ETIQUETA}] Hay ${correos.length} avisos pero el correo no está configurado.`);
  } else {
    for (const c of correos) {
      try {
        await enviarCorreo({ para: c.para, asunto: c.asunto, html: c.html });
        enviados++;
      } catch (e) {
        // Un correo que falla no puede tumbar el ciclo: la factura ya está
        // emitida y visible en la plataforma.
        fallidos++;
        console.error(`[${ETIQUETA}] No se pudo enviar a ${c.para}:`, e);
      }
    }
  }

  console.info(`[${ETIQUETA}] ciclo ok`, {
    dia: (data as Record<string, unknown>).dia,
    emitidas: (resultado.emitidas ?? []).length,
    vencidas: (resultado.vencidas ?? []).length,
    sin_activar: (cicloVida.avisos_activacion ?? []).length,
    bloqueadas: (cicloVida.bloqueadas ?? []).length,
    enviados, fallidos,
  });

  return responder({
    ok: true,
    ciclo: data,
    ciclo_vida: vida ?? null,
    correos: { enviados, fallidos },
  });
});
