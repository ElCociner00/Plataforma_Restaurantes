import { getUserContext } from './session.js';
import { APP_URLS } from './urls.js';
import { supabase } from './supabase.js';

let context;

document.addEventListener('DOMContentLoaded', async () => {
  context = await getUserContext().catch(() => null);
  if (!context) return;

  // Permitir solo admin y admin_root
  if (context.rol !== 'admin' && context.rol !== 'admin_root') {
    alert("Acceso denegado: Se requieren privilegios de administrador para ver el dashboard.");
    window.location.href = '../inicio/index.html';
    return;
  }

  document.body.style.display = 'block';

  // Configuración de UI
  setupTabs();
  setupFiltros();
  await loadSedes();

  // Cargar primera pestaña por defecto
  loadTabConciliacion();
});

// ==========================================
// CONFIGURACIÓN UI Y FILTROS
// ==========================================

function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remover clase active de todos los botones y ocultar paneles
      tabBtns.forEach(b => {
        b.classList.remove('active');
        b.style.borderBottom = '2px solid transparent';
        b.style.fontWeight = 'var(--ek-weight-medium)';
        b.style.color = 'var(--ek-muted)';
      });
      document.querySelectorAll('.tab-content').forEach(content => content.style.display = 'none');

      // Activar botón clickeado y su panel
      btn.classList.add('active');
      btn.style.borderBottom = '2px solid var(--ek-violet-600)';
      btn.style.fontWeight = 'var(--ek-weight-semibold)';
      btn.style.color = 'var(--ek-ink)';
      
      const targetId = btn.getAttribute('data-tab');
      document.getElementById(targetId).style.display = 'block';

      // Cargar datos correspondientes si no están cargados (o forzar recarga)
      reloadActiveTab();
    });
  });
}

// ---- Período y granularidad -------------------------------------------------

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function setupFiltros() {
  const hoy = new Date();
  document.getElementById('filtroMes').value = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  // Rango personalizado: arranca en el mes en curso para que nunca salga vacío.
  document.getElementById('filtroDesde').value = iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  document.getElementById('filtroHasta').value = iso(hoy);

  const periodo = document.getElementById('filtroPeriodo');
  const aplicarVisibilidad = () => {
    document.getElementById('grupoMes').style.display   = periodo.value === 'mes' ? '' : 'none';
    document.getElementById('grupoRango').style.display = periodo.value === 'personalizado' ? '' : 'none';
  };
  periodo.addEventListener('change', () => { aplicarVisibilidad(); reloadActiveTab(); });
  aplicarVisibilidad();

  ['filtroSede', 'filtroMes', 'filtroDesde', 'filtroHasta', 'filtroGranularidad']
    .forEach(id => document.getElementById(id).addEventListener('change', reloadActiveTab));
}

// Devuelve {desde, hasta} en formato YYYY-MM-DD, o null si el filtro está incompleto.
function getRangoSeleccionado() {
  const modo = document.getElementById('filtroPeriodo').value;
  const hoy = new Date();

  if (modo === 'mes') {
    const mesStr = document.getElementById('filtroMes').value;
    if (!mesStr) return null;
    const [y, m] = mesStr.split('-').map(Number);
    return { desde: iso(new Date(y, m - 1, 1)), hasta: iso(new Date(y, m, 0)) };
  }
  if (modo === 'personalizado') {
    const d = document.getElementById('filtroDesde').value;
    const h = document.getElementById('filtroHasta').value;
    if (!d || !h) return null;
    return d <= h ? { desde: d, hasta: h } : { desde: h, hasta: d };
  }
  if (modo === 'anio') {
    return { desde: iso(new Date(hoy.getFullYear(), 0, 1)), hasta: iso(hoy) };
  }
  const meses = modo === '3m' ? 3 : 6;
  return { desde: iso(new Date(hoy.getFullYear(), hoy.getMonth() - (meses - 1), 1)), hasta: iso(hoy) };
}

function getSedeSeleccionada() {
  const v = document.getElementById('filtroSede').value;
  return (v === 'todas' || v === '') ? null : v;
}

// Con rangos largos, una gráfica por día se vuelve ilegible: 178 puntos ya
// aprietan y un año son ~365. Se agrupa según la longitud del rango.
function granularidadEfectiva(desde, hasta) {
  const elegida = document.getElementById('filtroGranularidad').value;
  if (elegida !== 'auto') return elegida;
  const dias = Math.round((new Date(hasta) - new Date(desde)) / 86400000) + 1;
  if (dias <= 31) return 'dia';
  if (dias <= 120) return 'semana';
  return 'mes';
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Regla de agrupación compartida: dado un día, a qué cubo pertenece.
function claveDeFecha(fecha, granularidad) {
  const [y, m, d] = fecha.split('-').map(Number);
  if (granularidad === 'mes') {
    return { clave: `${y}-${String(m).padStart(2, '0')}`,
             etiqueta: `${MESES_CORTOS[m - 1]} ${y}`,
             detalle: 'Mes completo' };
  }
  if (granularidad === 'semana') {
    // Semana ISO: se retrocede hasta el lunes.
    const desplazamiento = (new Date(y, m - 1, d).getDay() + 6) % 7;
    const lunes = new Date(y, m - 1, d - desplazamiento);
    const clave = iso(lunes);
    return { clave,
             etiqueta: `${String(lunes.getDate()).padStart(2, '0')}/${String(lunes.getMonth() + 1).padStart(2, '0')}`,
             detalle: 'Semana del ' + clave };
  }
  return { clave: fecha,
           etiqueta: fecha.substring(8, 10) + '/' + fecha.substring(5, 7),
           detalle: nombreDiaSemana(fecha) };
}

// Agrupa una serie diaria en día, semana o mes sumando los campos indicados.
// Se hace en el navegador y no en SQL para no añadir un parámetro a funciones
// ya desplegadas: un año son ~365 filas (~15 KB) y agruparlas aquí no cuesta
// ni un viaje más a la base.
function agruparSerie(filas, granularidad, campos) {
  const grupos = new Map();
  [...filas].sort((a, b) => a.fecha.localeCompare(b.fecha)).forEach(f => {
    const k = claveDeFecha(f.fecha, granularidad);
    if (!grupos.has(k.clave)) {
      const inicial = { ...k };
      campos.forEach(c => { inicial[c] = 0; });
      grupos.set(k.clave, inicial);
    }
    const g = grupos.get(k.clave);
    campos.forEach(c => { g[c] += Number(f[c]) || 0; });
  });
  return [...grupos.values()].sort((a, b) => a.clave.localeCompare(b.clave));
}

function agruparEvolucion(ev, granularidad) {
  const filas = (ev || []).map(d => ({ fecha: d.fecha, venta: Number(d.venta_dia) || 0, turnos: Number(d.turnos_dia) || 0 }));
  return agruparSerie(filas, granularidad, ['venta', 'turnos']);
}

function agruparConciliacion(ev, granularidad) {
  const filas = (ev || []).map(d => ({ fecha: d.fecha, descuadre: Number(d.descuadre) || 0, difEfectivo: Number(d.dif_efectivo) || 0 }));
  return agruparSerie(filas, granularidad, ['descuadre', 'difEfectivo']);
}

async function loadSedes() {
  const filtroSede = document.getElementById('filtroSede');
  try {
    const { data, error } = await supabase.rpc('dashboard_sedes');
    if (error) throw error;

    filtroSede.innerHTML = '<option value="todas">Todas las sedes</option>';
    if (data && data.length > 0) {
      data.forEach(sede => {
        const option = document.createElement('option');
        option.value = sede.id;
        option.textContent = sede.nombre + (sede.tipo === 'principal' ? ' (Principal)' : '');
        filtroSede.appendChild(option);
      });
    }
  } catch (error) {
    console.error('Error cargando sedes:', error);
    filtroSede.innerHTML = '<option value="todas">Error al cargar sedes</option>';
  }
}

function reloadActiveTab() {
  const activeTab = document.querySelector('.tab-btn.active').getAttribute('data-tab');

  if (activeTab === 'tab-conciliacion') {
    loadTabConciliacion();
  } else if (activeTab === 'tab-ventas') {
    loadTabVentas();
  } else if (activeTab === 'tab-responsables') {
    loadTabResponsables();
  } else if (activeTab === 'tab-gastos') {
    loadTabGastos();
  }
}

// ==========================================
// CARGADORES DE PESTANAS
// ==========================================

async function loadTabConciliacion() {
  const loading = document.getElementById('loadingConciliacion');
  const content = document.getElementById('contentConciliacion');
  
  loading.style.display = 'block';
  content.style.display = 'none';

  const rango = getRangoSeleccionado();
  if (!rango) { loading.style.display = 'none'; return; }
  const { desde, hasta } = rango;
  const sedeId = getSedeSeleccionada();

  try {
    const { data, error } = await supabase.rpc('dashboard_conciliacion', {
      p_desde: desde,
      p_hasta: hasta,
      p_empresa_id: sedeId
    });

    if (error) throw error;

    const res = data.resumen || {};
    const ev = data.evolucion || [];

    const formatCurrency = (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(val || 0);
    const formatNumber = (val) => new Intl.NumberFormat('es-CO').format(val || 0);

    const porcDescuadrados = res.total_turnos > 0 ? Math.round((res.turnos_descuadrados / res.total_turnos) * 100) : 0;
    const colorPorc = porcDescuadrados > 10 ? 'var(--ek-bad-600)' : (porcDescuadrados > 0 ? 'var(--ek-warn-600)' : 'var(--ek-ok-600)');

    content.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
        
        <!-- Tarjeta 1: Descuadre Neto -->
        <div style="background: var(--ek-surface); border: 1px solid var(--ek-line); border-radius: var(--ek-radius-md); padding: 1.5rem; box-shadow: var(--ek-shadow-card);">
          <div style="color: var(--ek-muted); font-size: var(--ek-text-label); font-weight: var(--ek-weight-semibold); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">Descuadre Neto Total</div>
          <div style="font-size: var(--ek-text-metric); font-weight: var(--ek-weight-bold); color: ${res.descuadre_neto < 0 ? 'var(--ek-bad-600)' : (res.descuadre_neto > 0 ? 'var(--ek-warn-600)' : 'var(--ek-ink)')};">${formatCurrency(res.descuadre_neto)}</div>
          <div style="font-size: var(--ek-text-note); color: var(--ek-muted); margin-top: 0.25rem;">En ${formatNumber(res.total_turnos)} turnos auditados</div>
        </div>

        <!-- Tarjeta 2: Tasa de Descuadres -->
        <div style="background: var(--ek-surface); border: 1px solid var(--ek-line); border-radius: var(--ek-radius-md); padding: 1.5rem; box-shadow: var(--ek-shadow-card);">
          <div style="color: var(--ek-muted); font-size: var(--ek-text-label); font-weight: var(--ek-weight-semibold); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">Turnos Descuadrados</div>
          <div style="display: flex; align-items: baseline; gap: 0.5rem;">
            <div style="font-size: var(--ek-text-metric); font-weight: var(--ek-weight-bold); color: ${colorPorc};">${porcDescuadrados}%</div>
            <div style="font-size: var(--ek-text-body); color: var(--ek-muted);">(${res.turnos_descuadrados} turnos)</div>
          </div>
          <div style="font-size: var(--ek-text-note); color: var(--ek-muted); margin-top: 0.25rem;">Meta: 0%</div>
        </div>

      </div>

      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem; align-items: start;">
        
        <!-- Gráfica Evolución -->
        <div style="background: var(--ek-surface); border: 1px solid var(--ek-line); border-radius: var(--ek-radius-md); padding: 1.5rem; box-shadow: var(--ek-shadow-card);">
          <h3 style="margin: 0 0 1rem 0; font-size: var(--ek-text-section); color: var(--ek-ink);">Evolución Diaria del Descuadre</h3>
          <div style="height: 300px; position: relative;">
            <canvas id="chartEvolucionConciliacion"></canvas>
          </div>
        </div>

        <!-- Barras por Canal -->
        <div style="background: var(--ek-surface); border: 1px solid var(--ek-line); border-radius: var(--ek-radius-md); padding: 1.5rem; box-shadow: var(--ek-shadow-card);">
          <h3 style="margin: 0 0 1rem 0; font-size: var(--ek-text-section); color: var(--ek-ink);">Diferencias por Canal</h3>
          <div style="display: flex; flex-direction: column; gap: 1rem;">
            ${renderCanalRow('Efectivo', res.dif_efectivo)}
            ${renderCanalRow('Datáfono', res.dif_datafono)}
            ${renderCanalRow('Transferencias', res.dif_transferencias)}
            ${renderCanalRow('Rappi', res.dif_rappi)}
            ${renderCanalRow('Nequi', res.dif_nequi)}
          </div>
          <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--ek-line); text-align: center;">
            <a href="${APP_URLS.libroDescuadres}" style="color: var(--ek-violet-600); font-weight: var(--ek-weight-semibold); text-decoration: none; font-size: var(--ek-text-body); display: inline-flex; align-items: center; gap: 0.5rem;"><i class="ph ph-arrow-up-right"></i> Ir al Libro de Descuadres</a>
          </div>
        </div>

      </div>
    `;

    // Renderizar gráfica sobre la serie agrupada según el rango
    renderChartEvolucion(agruparConciliacion(ev, granularidadEfectiva(desde, hasta)));

  } catch (err) {
    console.error(err);
    content.innerHTML = `<div style="color: var(--ek-bad-600); padding: 2rem; text-align: center;">Error al cargar datos de conciliación.</div>`;
  } finally {
    loading.style.display = 'none';
    content.style.display = 'block';
  }
}

function renderCanalRow(nombre, valor) {
  const formatCurrency = (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(val || 0);
  const color = valor < 0 ? 'var(--ek-bad-600)' : (valor > 0 ? 'var(--ek-warn-600)' : 'var(--ek-ok-600)');
  return `
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <span style="font-weight: var(--ek-weight-medium); color: var(--ek-ink-2);">${nombre}</span>
      <span style="font-weight: var(--ek-weight-semibold); color: ${color};">${formatCurrency(valor)}</span>
    </div>
  `;
}

let chartEvolucion = null;
function renderChartEvolucion(ev) {
  const ctx = document.getElementById('chartEvolucionConciliacion').getContext('2d');
  
  if (chartEvolucion) {
    chartEvolucion.destroy();
  }

  chartEvolucion = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ev.map(d => d.etiqueta),
      datasets: [
        {
          label: 'Efectivo',
          data: ev.map(d => d.difEfectivo || 0),
          backgroundColor: '#059669',
          stack: 'Stack 0',
        },
        {
          label: 'Otros canales (Suma)',
          data: ev.map(d => (d.descuadre || 0) - (d.difEfectivo || 0)),
          backgroundColor: '#d97706',
          stack: 'Stack 0',
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: (context) => context.dataset.label + ': ' + new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(context.raw)
          }
        }
      },
      scales: {
        y: {
          ticks: {
            callback: (val) => new Intl.NumberFormat('es-CO', { notation: "compact", compactDisplay: "short" }).format(val)
          }
        }
      }
    }
  });
}

async function loadTabVentas() {
  const loading = document.getElementById('loadingVentas');
  const content = document.getElementById('contentVentas');
  
  loading.style.display = 'block';
  content.style.display = 'none';

  const rango = getRangoSeleccionado();
  if (!rango) { loading.style.display = 'none'; return; }
  const { desde, hasta } = rango;
  const sedeId = getSedeSeleccionada();

  try {
    const { data, error } = await supabase.rpc('dashboard_ventas', {
      p_desde: desde,
      p_hasta: hasta,
      p_empresa_id: sedeId
    });

    if (error) throw error;

    const res = data.resumen || {};
    const ev = data.evolucion || [];
    // El RPC sigue devolviendo `turnos`; la tabla de Turnos Recientes se retiro
    // a peticion del usuario y su sitio lo ocupa ahora la tabla de ventas por dia.

    const formatCurrency = (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(val || 0);

    const gran = granularidadEfectiva(desde, hasta);
    const serie = agruparEvolucion(ev, gran);

    content.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
        
        <!-- Tarjeta 1: Total Ventas -->
        <div style="background: var(--ek-surface); border: 1px solid var(--ek-line); border-radius: var(--ek-radius-md); padding: 1.5rem; box-shadow: var(--ek-shadow-card);">
          <div style="color: var(--ek-muted); font-size: var(--ek-text-label); font-weight: var(--ek-weight-semibold); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">Ventas Totales</div>
          <div style="font-size: var(--ek-text-metric); font-weight: var(--ek-weight-bold); color: var(--ek-ink);">${formatCurrency(res.total_ventas)}</div>
          <div style="font-size: var(--ek-text-note); color: var(--ek-muted); margin-top: 0.25rem;">En el período seleccionado</div>
        </div>

      </div>

      <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem; align-items: start; margin-bottom: 2rem;">
        
        <!-- Gráfica Evolución Ventas -->
        <div style="background: var(--ek-surface); border: 1px solid var(--ek-line); border-radius: var(--ek-radius-md); padding: 1.5rem; box-shadow: var(--ek-shadow-card);">
          <h3 style="margin: 0 0 1rem 0; font-size: var(--ek-text-section); color: var(--ek-ink);">Evolución de Ventas</h3>
          <div style="height: 300px; position: relative;">
            <canvas id="chartEvolucionVentas"></canvas>
          </div>
        </div>

        <!-- Gráfica Mix de Canales -->
        <div style="background: var(--ek-surface); border: 1px solid var(--ek-line); border-radius: var(--ek-radius-md); padding: 1.5rem; box-shadow: var(--ek-shadow-card);">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap;">
            <h3 style="margin: 0; font-size: var(--ek-text-section); color: var(--ek-ink);">Mix de Canales</h3>
            <label style="display: inline-flex; align-items: center; gap: 0.4rem; font-size: var(--ek-text-note); color: var(--ek-muted); cursor: pointer; user-select: none;" title="El efectivo se guarda descontando los gastos pagados de la caja. Desmárcalo para ver el efectivo tal como entró.">
              <input type="checkbox" id="toggleEfectivoNeto" checked style="cursor: pointer;">
              Efectivo neto
            </label>
          </div>
          <div style="height: 300px; position: relative;">
            <canvas id="chartMixCanales"></canvas>
          </div>
        </div>

      </div>

      <!-- Ventas por periodo -->
      ${renderTablaVentasPorPeriodo(serie, gran)}
    `;

    renderChartEvolucionVentas(serie, gran);
    renderChartMixCanales(res, true);

    // El interruptor solo repinta la dona: no vuelve a consultar la base.
    const toggle = document.getElementById('toggleEfectivoNeto');
    if (toggle) toggle.addEventListener('change', () => renderChartMixCanales(res, toggle.checked));

  } catch (err) {
    console.error(err);
    content.innerHTML = `<div style="color: var(--ek-bad-600); padding: 2rem; text-align: center;">Error al cargar datos de ventas.</div>`;
  } finally {
    loading.style.display = 'none';
    content.style.display = 'block';
  }
}

// ==========================================
// TABLA DE VENTAS POR DIA
// ==========================================
// Se alimenta del bloque `evolucion` que dashboard_ventas ya devuelve para la
// grafica: no hace ninguna consulta adicional.

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];

function nombreDiaSemana(fechaISO) {
  const [y, m, d] = String(fechaISO).split('-').map(Number);
  if (!y || !m || !d) return '';
  // Construida como fecha local para que no se corra un dia por zona horaria.
  return DIAS_SEMANA[new Date(y, m - 1, d).getDay()] || '';
}

const TITULO_GRAN = { dia: 'Ventas por día', semana: 'Ventas por semana', mes: 'Ventas por mes' };
const COLUMNA_GRAN = { dia: 'Día', semana: 'Semana del', mes: 'Período' };

function renderTablaVentasPorPeriodo(serie, granularidad) {
  const fmt = (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(val || 0);
  const num = (val) => new Intl.NumberFormat('es-CO').format(val || 0);

  const filasDatos = serie || [];
  const total = filasDatos.reduce((sum, f) => sum + f.venta, 0);
  const totalTurnos = filasDatos.reduce((sum, f) => sum + f.turnos, 0);
  const maximo = filasDatos.length ? Math.max(...filasDatos.map(f => f.venta)) : 0;
  const minimo = filasDatos.length ? Math.min(...filasDatos.map(f => f.venta)) : 0;

  const cabecera = `
    <div style="padding: 1.5rem; border-bottom: 1px solid var(--ek-line); display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap;">
      <h3 style="margin: 0; font-size: var(--ek-text-section); color: var(--ek-ink);">${TITULO_GRAN[granularidad] || 'Ventas por período'}</h3>
      <span style="font-size: var(--ek-text-note); color: var(--ek-muted);">${filasDatos.length} ${filasDatos.length === 1 ? 'registro' : 'registros'} · ${num(totalTurnos)} turnos</span>
    </div>`;

  if (!filasDatos.length) {
    return `
      <div style="background: var(--ek-surface); border: 1px solid var(--ek-line); border-radius: var(--ek-radius-md); box-shadow: var(--ek-shadow-card); overflow: hidden;">
        ${cabecera}
        <div style="padding: 3rem 1.5rem; text-align: center; color: var(--ek-muted);">
          <i class="ph ph-calendar-blank" style="font-size: 2rem; display: block; margin-bottom: 0.5rem;"></i>
          No hay ventas registradas en este período.
        </div>
      </div>`;
  }

  // Más reciente primero: es lo que se suele querer mirar de un vistazo.
  const filas = [...filasDatos].sort((a, b) => b.clave.localeCompare(a.clave)).map(f => {
    const pct = total > 0 ? (f.venta / total) * 100 : 0;
    const ancho = maximo > 0 ? (f.venta / maximo) * 100 : 0;
    const marca = filasDatos.length > 1 && f.venta === maximo
      ? '<span style="margin-left: 0.5rem; font-size: var(--ek-text-note); color: var(--ek-ok-600); font-weight: var(--ek-weight-semibold);">mejor</span>'
      : (filasDatos.length > 1 && f.venta === minimo
        ? '<span style="margin-left: 0.5rem; font-size: var(--ek-text-note); color: var(--ek-muted); font-weight: var(--ek-weight-semibold);">menor</span>' : '');

    return `
      <tr style="border-bottom: 1px solid var(--ek-line);">
        <td style="padding: 0.85rem 1.5rem; color: var(--ek-ink-2); white-space: nowrap;">${f.clave}${marca}</td>
        <td style="padding: 0.85rem 1.5rem; color: var(--ek-muted); white-space: nowrap;">${f.detalle}</td>
        <td style="padding: 0.85rem 1.5rem; text-align: right; color: var(--ek-muted); white-space: nowrap;">${num(f.turnos)}</td>
        <td style="padding: 0.85rem 1.5rem; text-align: right; color: var(--ek-ink-2); font-weight: var(--ek-weight-medium); white-space: nowrap;">${fmt(f.venta)}</td>
        <td style="padding: 0.85rem 1.5rem; min-width: 140px;">
          <div style="display: flex; align-items: center; gap: 0.6rem;">
            <div style="flex: 1; height: 6px; background: var(--ek-surface-2); border-radius: 999px; overflow: hidden;">
              <div style="width: ${ancho.toFixed(1)}%; height: 100%; background: var(--ek-violet-600); border-radius: 999px;"></div>
            </div>
            <span style="font-size: var(--ek-text-note); color: var(--ek-muted); white-space: nowrap; min-width: 3.2em; text-align: right;">${pct.toFixed(1)}%</span>
          </div>
        </td>
      </tr>`;
  }).join('');

  const th = 'padding: 0.85rem 1.5rem; border-bottom: 1px solid var(--ek-line); position: sticky; top: 0; background: var(--ek-surface-2); z-index: 1;';

  return `
    <div style="background: var(--ek-surface); border: 1px solid var(--ek-line); border-radius: var(--ek-radius-md); box-shadow: var(--ek-shadow-card); overflow: hidden;">
      ${cabecera}
      <div style="overflow-x: auto; max-height: 460px; overflow-y: auto;">
        <table style="width: 100%; border-collapse: collapse; text-align: left;">
          <thead style="font-size: var(--ek-text-label); color: var(--ek-muted); text-transform: uppercase;">
            <tr>
              <th style="${th}">${COLUMNA_GRAN[granularidad] || 'Período'}</th>
              <th style="${th}">Detalle</th>
              <th style="${th} text-align: right;">Turnos</th>
              <th style="${th} text-align: right;">Venta</th>
              <th style="${th}">% del período</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <div style="padding: 1rem 1.5rem; border-top: 1px solid var(--ek-line); background: var(--ek-surface-2); display: flex; justify-content: space-between; align-items: baseline; gap: 1rem;">
        <span style="font-size: var(--ek-text-label); color: var(--ek-muted); text-transform: uppercase; font-weight: var(--ek-weight-semibold); letter-spacing: 0.05em;">Total del período</span>
        <span style="font-size: var(--ek-text-body); color: var(--ek-ink); font-weight: var(--ek-weight-bold);">${fmt(total)}</span>
      </div>
    </div>`;
}


let chartEvolVentas = null;
function renderChartEvolucionVentas(ev, granularidad = 'dia') {
  const ctx = document.getElementById('chartEvolucionVentas').getContext('2d');
  if (chartEvolVentas) chartEvolVentas.destroy();

  chartEvolVentas = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ev.map(d => d.etiqueta),
      datasets: [{
        label: 'Ventas',
        data: ev.map(d => d.venta || 0),
        borderColor: '#7c3aed',
        backgroundColor: 'rgba(124, 58, 237, 0.1)',
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(context.raw)
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: (val) => new Intl.NumberFormat('es-CO', { notation: "compact", compactDisplay: "short" }).format(val) }
        }
      }
    }
  });
}

let chartMix = null;
// `neto = false` devuelve al efectivo los gastos que se le habían restado al
// guardarlo. No añade el gasto a la dona: repone el efectivo a su valor real.
function renderChartMixCanales(res, neto = true) {
  const ctx = document.getElementById('chartMixCanales').getContext('2d');
  if (chartMix) chartMix.destroy();

  chartMix = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: [neto ? 'Efectivo (neto)' : 'Efectivo (bruto)', 'Datáfono', 'Transf.', 'Rappi', 'Nequi', 'Bono'],
      datasets: [{
        data: [
          (Number(res.ventas_efectivo) || 0) + (neto ? 0 : (Number(res.total_gastos) || 0)),
          res.ventas_datafono || 0,
          res.ventas_transferencias || 0,
          res.ventas_rappi || 0,
          res.ventas_nequi || 0,
          res.ventas_bono || 0
        ],
        backgroundColor: [
          '#059669', // Efectivo
          '#2563eb', // Datáfono
          '#7c3aed', // Transf
          '#dc2626', // Rappi
          '#d97706', // Nequi
          '#64748b'  // Bono
        ]
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right' },
        tooltip: {
          callbacks: {
            label: (context) => context.label + ': ' + new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(context.raw)
          }
        }
      }
    }
  });
}

// ==========================================
// VENTAS POR RESPONSABLE DE TURNO
// ==========================================
// Mide las ventas de los turnos que cada persona tuvo A CARGO, no lo que esa
// persona vendió: en un restaurante vende el equipo y el responsable es quien
// cerró el turno. El título de la pestaña lo dice así a propósito.

let modoRankingTotal = true;   // true = por venta total, false = por venta/turno
let chartResponsables = null;

async function loadTabResponsables() {
  const loading = document.getElementById('loadingResponsables');
  const content = document.getElementById('contentResponsables');

  loading.style.display = 'block';
  content.style.display = 'none';

  const rango = getRangoSeleccionado();
  if (!rango) { loading.style.display = 'none'; return; }
  const { desde, hasta } = rango;
  const sedeId = getSedeSeleccionada();

  try {
    const { data, error } = await supabase.rpc('dashboard_ventas_responsable', {
      p_desde: desde,
      p_hasta: hasta,
      p_empresa_id: sedeId
    });
    if (error) throw error;

    const res = data.resumen || {};
    const lista = (data.responsables || []).map(r => ({
      nombre: r.responsable || 'Sin responsable',
      turnos: Number(r.turnos) || 0,
      total: Number(r.venta_total) || 0,
      porTurno: Number(r.venta_por_turno) || 0
    }));

    const fmt = (v) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v || 0);
    const num = (v) => new Intl.NumberFormat('es-CO').format(v || 0);

    content.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
        ${tarjetaResumen('Responsables con turnos', num(res.responsables), num(res.turnos_total) + ' turnos en el período')}
        ${tarjetaResumen('Venta del período', fmt(res.venta_total), 'Suma de todos los responsables')}
      </div>

      <div style="background: var(--ek-surface); border: 1px solid var(--ek-line); border-radius: var(--ek-radius-md); box-shadow: var(--ek-shadow-card); overflow: hidden; margin-bottom: 2rem;">
        <div style="padding: 1.5rem; border-bottom: 1px solid var(--ek-line); display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
          <h3 style="margin: 0; font-size: var(--ek-text-section); color: var(--ek-ink);">Ventas por responsable de turno</h3>
          <div style="display: inline-flex; border: 1px solid var(--ek-line); border-radius: var(--ek-radius-md); overflow: hidden;">
            <button type="button" data-modo="total" class="btn-modo-ranking" style="border: none; padding: 0.4rem 0.9rem; cursor: pointer; font-size: var(--ek-text-note);">Venta total</button>
            <button type="button" data-modo="promedio" class="btn-modo-ranking" style="border: none; padding: 0.4rem 0.9rem; cursor: pointer; font-size: var(--ek-text-note);">Venta por turno</button>
          </div>
        </div>
        <div style="padding: 1.5rem;">
          <div style="height: ${Math.max(220, lista.length * 46)}px; position: relative;">
            <canvas id="chartResponsables"></canvas>
          </div>
        </div>
      </div>

      ${renderTablaResponsables(lista)}
    `;

    if (lista.length) {
      pintarRankingResponsables(lista);
      content.querySelectorAll('.btn-modo-ranking').forEach(btn => {
        btn.addEventListener('click', () => {
          modoRankingTotal = btn.getAttribute('data-modo') === 'total';
          pintarRankingResponsables(lista);
        });
      });
    }

  } catch (err) {
    console.error(err);
    content.innerHTML = `<div style="color: var(--ek-bad-600); padding: 2rem; text-align: center;">Error al cargar las ventas por responsable.</div>`;
  } finally {
    loading.style.display = 'none';
    content.style.display = 'block';
  }
}

function tarjetaResumen(titulo, valor, nota) {
  return `
    <div style="background: var(--ek-surface); border: 1px solid var(--ek-line); border-radius: var(--ek-radius-md); padding: 1.5rem; box-shadow: var(--ek-shadow-card);">
      <div style="color: var(--ek-muted); font-size: var(--ek-text-label); font-weight: var(--ek-weight-semibold); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">${titulo}</div>
      <div style="font-size: var(--ek-text-metric); font-weight: var(--ek-weight-bold); color: var(--ek-ink);">${valor}</div>
      <div style="font-size: var(--ek-text-note); color: var(--ek-muted); margin-top: 0.25rem;">${nota}</div>
    </div>`;
}

function pintarRankingResponsables(lista) {
  const orden = [...lista].sort((a, b) => (modoRankingTotal ? b.total - a.total : b.porTurno - a.porTurno));
  const valores = orden.map(r => modoRankingTotal ? r.total : r.porTurno);

  document.querySelectorAll('.btn-modo-ranking').forEach(btn => {
    const activo = (btn.getAttribute('data-modo') === 'total') === modoRankingTotal;
    btn.style.background = activo ? 'var(--ek-violet-600)' : 'var(--ek-surface)';
    btn.style.color = activo ? '#ffffff' : 'var(--ek-muted)';
    btn.style.fontWeight = activo ? 'var(--ek-weight-semibold)' : 'var(--ek-weight-medium)';
  });

  const ctx = document.getElementById('chartResponsables');
  if (!ctx) return;
  if (chartResponsables) chartResponsables.destroy();

  // El primero y el último resaltados, que es lo que se quiere ver de un vistazo.
  const colores = valores.map((_, i) => i === 0 ? '#059669' : (i === valores.length - 1 && valores.length > 1 ? '#d97706' : '#7c3aed'));

  chartResponsables = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels: orden.map(r => r.nombre),
      datasets: [{
        label: modoRankingTotal ? 'Venta total' : 'Venta por turno',
        data: valores,
        backgroundColor: colores,
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => c.dataset.label + ': ' + new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(c.raw)
          }
        }
      },
      scales: {
        x: { beginAtZero: true, ticks: { callback: (v) => new Intl.NumberFormat('es-CO', { notation: 'compact', compactDisplay: 'short' }).format(v) } }
      }
    }
  });
}

function renderTablaResponsables(lista) {
  const fmt = (v) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v || 0);
  const num = (v) => new Intl.NumberFormat('es-CO').format(v || 0);
  const th = 'padding: 0.85rem 1.5rem; border-bottom: 1px solid var(--ek-line); position: sticky; top: 0; background: var(--ek-surface-2); z-index: 1;';

  if (!lista.length) {
    return `
      <div style="background: var(--ek-surface); border: 1px solid var(--ek-line); border-radius: var(--ek-radius-md); box-shadow: var(--ek-shadow-card); padding: 3rem 1.5rem; text-align: center; color: var(--ek-muted);">
        <i class="ph ph-users-three" style="font-size: 2rem; display: block; margin-bottom: 0.5rem;"></i>
        No hay turnos con responsable en este período.
      </div>`;
  }

  const total = lista.reduce((s, r) => s + r.total, 0);
  const totalTurnos = lista.reduce((s, r) => s + r.turnos, 0);
  const orden = [...lista].sort((a, b) => b.total - a.total);
  const mejorPorTurno = Math.max(...lista.map(r => r.porTurno));

  const filas = orden.map((r, i) => {
    const pct = total > 0 ? (r.total / total) * 100 : 0;
    const marcas = [];
    if (i === 0) marcas.push('<span style="font-size: var(--ek-text-note); color: var(--ek-ok-600); font-weight: var(--ek-weight-semibold);">más vende</span>');
    if (i === orden.length - 1 && orden.length > 1) marcas.push('<span style="font-size: var(--ek-text-note); color: var(--ek-muted); font-weight: var(--ek-weight-semibold);">menos vende</span>');
    if (r.porTurno === mejorPorTurno && orden.length > 1) marcas.push('<span style="font-size: var(--ek-text-note); color: var(--ek-violet-600); font-weight: var(--ek-weight-semibold);">mejor por turno</span>');
    const bloqueMarcas = marcas.length
      ? '<div style="display: flex; gap: 0.5rem; margin-top: 0.15rem; flex-wrap: wrap;">' + marcas.join('') + '</div>'
      : '';
    return `
      <tr style="border-bottom: 1px solid var(--ek-line);">
        <td style="padding: 0.85rem 1.5rem; color: var(--ek-muted); text-align: right;">${i + 1}</td>
        <td style="padding: 0.85rem 1.5rem; color: var(--ek-ink-2);">${r.nombre}${bloqueMarcas}</td>
        <td style="padding: 0.85rem 1.5rem; text-align: right; color: var(--ek-muted);">${num(r.turnos)}</td>
        <td style="padding: 0.85rem 1.5rem; text-align: right; color: var(--ek-ink-2); font-weight: var(--ek-weight-medium);">${fmt(r.total)}</td>
        <td style="padding: 0.85rem 1.5rem; text-align: right; color: var(--ek-ink-2);">${fmt(r.porTurno)}</td>
        <td style="padding: 0.85rem 1.5rem; text-align: right; color: var(--ek-muted);">${pct.toFixed(1)}%</td>
      </tr>`;
  }).join('');

  return `
    <div style="background: var(--ek-surface); border: 1px solid var(--ek-line); border-radius: var(--ek-radius-md); box-shadow: var(--ek-shadow-card); overflow: hidden;">
      <div style="padding: 1.5rem; border-bottom: 1px solid var(--ek-line);">
        <h3 style="margin: 0; font-size: var(--ek-text-section); color: var(--ek-ink);">Detalle por responsable</h3>
        <p style="margin: 0.25rem 0 0 0; font-size: var(--ek-text-note); color: var(--ek-muted);">Ventas de los turnos que cada persona tuvo a cargo.</p>
      </div>
      <div style="overflow-x: auto; max-height: 460px; overflow-y: auto;">
        <table style="width: 100%; border-collapse: collapse; text-align: left;">
          <thead style="font-size: var(--ek-text-label); color: var(--ek-muted); text-transform: uppercase;">
            <tr>
              <th style="${th} text-align: right;">#</th>
              <th style="${th}">Responsable</th>
              <th style="${th} text-align: right;">Turnos</th>
              <th style="${th} text-align: right;">Venta total</th>
              <th style="${th} text-align: right;">Venta por turno</th>
              <th style="${th} text-align: right;">% del total</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <div style="padding: 1rem 1.5rem; border-top: 1px solid var(--ek-line); background: var(--ek-surface-2); display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap;">
        <span style="font-size: var(--ek-text-label); color: var(--ek-muted); text-transform: uppercase; font-weight: var(--ek-weight-semibold); letter-spacing: 0.05em;">Total · ${num(totalTurnos)} turnos</span>
        <span style="font-size: var(--ek-text-body); color: var(--ek-ink); font-weight: var(--ek-weight-bold);">${fmt(total)}</span>
      </div>
    </div>`;
}

async function loadTabGastos() {
  const loading = document.getElementById('loadingGastos');
  const content = document.getElementById('contentGastos');
  
  loading.style.display = 'block';
  content.style.display = 'none';

  // TODO: Fase 5
  
  setTimeout(() => {
    loading.style.display = 'none';
    content.style.display = 'block';
    content.innerHTML = `
      <div style="background: var(--ek-surface); border: 1px solid var(--ek-line); border-radius: var(--ek-radius-md); padding: 2rem; text-align: center;">
        <h3 style="margin-top:0; color: var(--ek-ink);">Gastos Operativos</h3>
        <p style="color: var(--ek-muted); max-width: 500px; margin: 0 auto; line-height: var(--ek-leading-relaxed);">
          <i class="ph ph-info" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem; color: var(--ek-info-600);"></i>
          Esta sección funcionará plenamente cuando existan datos suficientes y recurrentes de la estructura de gastos fijos.
        </p>
      </div>
    `;
  }, 500);
}
