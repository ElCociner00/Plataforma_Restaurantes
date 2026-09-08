export function initBulkActions() {
  document.querySelectorAll('.bulk-actions').forEach(container => {
    const targetId = container.dataset.target;
    const targetPanel = document.getElementById(targetId);
    if (!targetPanel) return;

    const btnActivar = container.querySelector('.btn-bulk-activar');
    const btnDesactivar = container.querySelector('.btn-bulk-desactivar');

    btnActivar?.addEventListener('click', () => {
      targetPanel.querySelectorAll('input[type="checkbox"]').forEach(chk => {
        if (!chk.checked) {
          chk.checked = true;
          chk.dispatchEvent(new Event('change'));
        }
      });
    });

    btnDesactivar?.addEventListener('click', () => {
      targetPanel.querySelectorAll('input[type="checkbox"]').forEach(chk => {
        if (chk.checked) {
          chk.checked = false;
          chk.dispatchEvent(new Event('change'));
        }
      });
    });
  });
}
