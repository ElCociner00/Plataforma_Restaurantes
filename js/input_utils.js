export function enforceNumericInput(elements) {
  elements.forEach(element => {
    if (!element) return;
    element.addEventListener("input", () => {
      const digitsOnly = element.value.replace(/\D+/g, "");
      if (element.value !== digitsOnly) {
        element.value = digitsOnly;
      }
    });
  });
}
