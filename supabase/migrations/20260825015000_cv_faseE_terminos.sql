-- ============================================================================
-- CICLO DE VIDA · FASE E — Términos y condiciones
--
-- Contexto: docs/2026-08-25_plan_ciclo_de_vida_cliente.md §3 Fase E
--
-- Los términos anteriores eran tres párrafos sobre responsabilidad contable.
-- Faltaban todas las cláusulas que sostienen el sistema de facturación: qué se
-- cobra, cuándo, qué pasa si no se paga, qué pasa al darse de baja y qué se
-- hace con los datos.
--
-- DOS AVISOS IMPORTANTES SOBRE LA REDACCIÓN
--
--   1. La cláusula de borrado dice que AXIOMA "podrá eliminar" los datos
--      transcurridos 90 días, con aviso previo. NO dice que los elimine
--      automáticamente, porque la purga todavía no está implementada. Prometer
--      un borrado que no ocurre es peor que no prometerlo.
--
--   2. Esto no es asesoría legal. El texto es técnicamente coherente con lo
--      que el sistema hace de verdad, pero conviene que lo revise un abogado
--      colombiano antes de darlo por definitivo, sobre todo el apartado 8.
-- ============================================================================

begin;

insert into public.terminos_versiones (version, titulo, contenido_html, resumen_cambios, publicado_en, vigente)
values (
  '2026-08-25',
  'Términos y Condiciones del Servicio AXIOMA',
  $html$
<h2>1. Quiénes somos y qué es AXIOMA</h2>
<p>AXIOMA es una plataforma tecnológica de gestión para restaurantes, operada
por Global Nexo Shop S.A.S. Permite registrar cierres de turno, inventarios,
compras, nómina y ventas, y ver esa información consolidada.</p>
<p>AXIOMA <strong>no es</strong> un contador público, auditor, entidad
financiera ni autoridad tributaria. Realiza operaciones matemáticas sobre los
datos que el usuario ingresa y no interpreta ni garantiza la corrección fiscal,
legal o contable de los resultados. Conforme al artículo 23 del Código de
Comercio colombiano, la responsabilidad por los registros contables es del
comerciante.</p>

<h2>2. Cuenta, sedes y usuarios</h2>
<p>El servicio se contrata por <strong>cuenta</strong>. Una cuenta agrupa una
empresa principal y las sedes que se le añadan. Cada cuenta tiene un
administrador principal, que es quien puede contratar, activar la prueba,
cambiar el plan y darse de baja.</p>
<p>El titular de la cuenta es responsable de las credenciales de sus usuarios y
de la información que ingresen.</p>

<h2>3. Precios</h2>
<ul>
  <li><strong>Plan mensual: $59.900 COP</strong>, que incluye la empresa
      principal y <strong>un local sin costo adicional</strong>.</li>
  <li><strong>Local adicional: $30.000 COP al mes</strong> cada uno, a partir
      del segundo local.</li>
  <li><strong>Plan anual: 20% de descuento</strong> sobre doce mensualidades.
      Para una cuenta de hasta dos sedes, $575.040 COP al año.</li>
</ul>
<p>Los precios están expresados en pesos colombianos. Si en el futuro el
servicio queda gravado con IVA u otro impuesto, se discriminará en la factura y
se informará antes de aplicarlo.</p>
<p>AXIOMA puede modificar sus precios avisando con <strong>al menos 30 días de
antelación</strong> al correo de facturación registrado. El cambio no afecta a
periodos ya pagados.</p>

<h2>4. Prueba gratuita y plazo para activarla</h2>
<p>Toda cuenta nueva dispone de <strong>15 días de prueba gratuita</strong>. La
prueba <strong>no empieza al registrarse</strong>: empieza cuando el
administrador de la cuenta pulsa «Activar mi prueba» en la plataforma, de modo
que el cliente elige cuándo comenzar.</p>
<p>Para activarla hay un plazo de <strong>30 días desde el registro</strong>. Si
transcurre sin que se active, la cuenta queda bloqueada y solo conserva el
acceso a la pantalla de facturación; puede reabrirse contactando a AXIOMA.</p>
<p>Cuando AXIOMA acompaña la puesta en marcha, la cuenta puede marcarse «en
implementación», y en ese caso <strong>el plazo de 30 días queda
suspendido</strong> mientras dure el montaje.</p>
<p>La prueba no requiere registrar medio de pago.</p>

<h2>5. Facturación y pago</h2>
<ul>
  <li>El cobro es <strong>vencido</strong>: se usa el mes y se paga al cerrar.</li>
  <li><strong>Fecha de corte: el último día de cada mes.</strong></li>
  <li><strong>Fecha límite de pago: el día 5 del mes siguiente.</strong></li>
  <li>La factura se emite y se envía por correo alrededor del día 25.</li>
  <li>El primer periodo después de la prueba se cobra
      <strong>prorrateado por días</strong> hasta el fin de ese mes.</li>
  <li>Si se añaden o retiran sedes a mitad de periodo, la diferencia se
      prorratea en la factura siguiente.</li>
</ul>
<p>Los pagos en línea se procesan a través de <strong>Wompi</strong>
(Bancolombia). AXIOMA no almacena números completos de tarjeta: esa información
la custodia la pasarela de pagos.</p>

<h2>6. Mora</h2>
<p>Si una factura supera su fecha límite de pago, la cuenta queda marcada en
mora y se muestran avisos dentro de la plataforma. AXIOMA podrá restringir el
acceso a las funciones de registro tras la mora, previo aviso al correo de
facturación. Las restricciones, cuando se apliquen, dejarán siempre disponibles
la consulta de la información ya registrada y la pantalla de facturación, para
que el cliente pueda ponerse al día.</p>
<p>La suspensión del servicio no extingue las cantidades adeudadas.</p>

<h2>7. Baja del servicio</h2>
<p>El administrador de la cuenta puede darse de baja en cualquier momento desde
la pantalla de facturación. Al hacerlo:</p>
<ul>
  <li>Se cancela la renovación automática y se deja de emitir facturas nuevas.</li>
  <li><strong>No hay reembolsos.</strong> Los periodos ya pagados se disfrutan
      hasta su fecha de finalización y no se devuelve, total ni parcialmente,
      el importe abonado.</li>
  <li>Las facturas emitidas y no pagadas <strong>siguen siendo exigibles</strong>.</li>
  <li>Se suspenden todos los accesos <strong>excepto la pantalla de
      facturación</strong>, desde la cual el cliente puede retomar su plan y
      descargar su información.</li>
  <li>El cliente puede <strong>reactivar su cuenta</strong> mientras sus datos
      sigan disponibles, recuperando toda su información.</li>
</ul>

<h2>8. Conservación y eliminación de datos</h2>
<p>Tras la baja, AXIOMA conserva la información de la cuenta durante un
<strong>periodo mínimo de 90 días</strong>, para permitir la reactivación y la
descarga de los datos.</p>
<p>Transcurrido ese plazo, <strong>AXIOMA podrá eliminar de forma permanente e
irreversible</strong> la información operativa de la cuenta (cierres de turno,
inventarios, compras, nómina, usuarios y documentos adjuntos), avisando al
correo de facturación con <strong>al menos 7 días de antelación</strong>. Se
recomienda descargar la información antes de la baja.</p>
<p>AXIOMA <strong>conservará</strong>, incluso después de esa eliminación, los
registros de facturación y pago (facturas emitidas, importes y fechas), en
cumplimiento de sus propias obligaciones contables y tributarias como
proveedor, conforme a los artículos 28 y siguientes del Código de Comercio.
Estos registros se conservan disociados de la información operativa.</p>

<h2>9. Tratamiento de datos personales</h2>
<p>AXIOMA trata datos personales conforme a la <strong>Ley 1581 de 2012</strong>
y el <strong>Decreto 1377 de 2013</strong>.</p>
<ul>
  <li><strong>Responsable del tratamiento:</strong> Global Nexo Shop S.A.S.</li>
  <li><strong>Finalidad:</strong> prestar el servicio contratado, facturarlo,
      dar soporte y cumplir obligaciones legales.</li>
  <li><strong>Datos tratados:</strong> identificación y contacto del titular de
      la cuenta y de los usuarios que este registre, y la información operativa
      que el cliente ingrese.</li>
  <li><strong>Rol respecto a los datos de los empleados del cliente:</strong>
      AXIOMA actúa como <em>encargado</em>; el cliente es el <em>responsable</em>
      y garantiza contar con las autorizaciones necesarias.</li>
  <li><strong>Derechos del titular:</strong> conocer, actualizar, rectificar y
      suprimir sus datos, y revocar la autorización, escribiendo a
      <a href="mailto:facturacion@enkrato.com">facturacion@enkrato.com</a>.</li>
</ul>
<p>AXIOMA no vende ni cede datos personales a terceros con fines comerciales.
Los comparte únicamente con los proveedores necesarios para prestar el servicio
(alojamiento, correo transaccional y pasarela de pagos).</p>

<h2>10. Disponibilidad del servicio</h2>
<p>AXIOMA se presta «tal cual» y en función de su disponibilidad. Se hace un
esfuerzo razonable por mantener el servicio operativo, pero no se garantiza
disponibilidad ininterrumpida ni ausencia de errores. Las interrupciones
programadas se avisarán con antelación cuando sea posible.</p>
<p>El cliente es responsable de conservar sus propias copias de la información
que considere crítica.</p>

<h2>11. Limitación de responsabilidad</h2>
<p>En la máxima medida permitida por la ley colombiana, la responsabilidad total
de AXIOMA frente al cliente, por cualquier causa, se limita al importe efectivamente
pagado por el cliente en los <strong>tres meses</strong> anteriores al hecho que
origine la reclamación.</p>
<p>AXIOMA no responde por lucro cesante, pérdida de oportunidad, sanciones
tributarias ni decisiones de negocio tomadas a partir de la información
mostrada en la plataforma.</p>

<h2>12. Cambios en estos términos</h2>
<p>AXIOMA puede modificar estos términos. Cada versión queda registrada con su
fecha, y los cambios sustanciales se avisan con al menos 30 días de antelación
al correo de facturación. Continuar usando el servicio tras la entrada en vigor
supone la aceptación de la nueva versión.</p>

<h2>13. Ley aplicable y jurisdicción</h2>
<p>Estos términos se rigen por la ley colombiana. Cualquier controversia se
someterá a los jueces de la República de Colombia.</p>

<h2>14. Contacto</h2>
<p>Facturación y soporte:
<a href="mailto:facturacion@enkrato.com">facturacion@enkrato.com</a></p>
  $html$,
  'Primera versión completa: precios, prueba de 15 días, ventana de activación de 30 días, calendario de facturación, mora, baja sin reembolsos, conservación de datos 90 días y tratamiento de datos personales.',
  '2026-08-25',
  true
)
on conflict (version) do update
  set contenido_html = excluded.contenido_html,
      resumen_cambios = excluded.resumen_cambios,
      titulo = excluded.titulo;

-- ----------------------------------------------------------------------------
-- Los clientes que ya existían aceptaron condiciones distintas (o ninguna).
-- Se les registra la versión vigente como aceptada por continuidad, dejando
-- constancia de que es una asignación administrativa y no un clic suyo.
-- ----------------------------------------------------------------------------
insert into public.aceptaciones_terminos (cuenta_id, usuario_id, correo, version_id, ip, user_agent)
select c.id,
       '00000000-0000-0000-0000-000000000000'::uuid,
       c.correo_facturacion,
       tv.id,
       '',
       'asignacion administrativa · cliente anterior a esta versión'
from public.cuentas c
cross join (select id from public.terminos_versiones where vigente limit 1) tv
where c.tipo = 'cliente'
  and not exists (
    select 1 from public.aceptaciones_terminos a
    where a.cuenta_id = c.id and a.version_id = tv.id
  );

commit;
