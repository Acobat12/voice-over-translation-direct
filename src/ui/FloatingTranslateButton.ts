export function ensureFloatingTranslateButton(
  onClick: () => void,
): HTMLButtonElement {
  let btn = document.getElementById(
    "vot-floating-translate-btn",
  ) as HTMLButtonElement | null;

  if (!btn) {
    btn = document.createElement("button");
    btn.id = "vot-floating-translate-btn";
    btn.textContent = "Перевод";
    btn.style.position = "fixed";
    btn.style.right = "16px";
    btn.style.bottom = "16px";
    btn.style.zIndex = "2147483647";
    btn.style.padding = "10px 14px";
    btn.style.borderRadius = "999px";
    btn.style.border = "none";
    btn.style.background = "#2563eb";
    btn.style.color = "#fff";
    btn.style.cursor = "pointer";
    btn.style.boxShadow = "0 8px 24px rgba(0,0,0,.25)";
    btn.style.fontSize = "14px";
    btn.style.fontWeight = "600";
    btn.style.fontFamily = "system-ui, sans-serif";

    document.body.appendChild(btn);
  }

  btn.onclick = onClick;
  btn.style.display = "block";

  return btn;
}

export function hideFloatingTranslateButton(): void {
  const btn = document.getElementById(
    "vot-floating-translate-btn",
  ) as HTMLButtonElement | null;

  if (btn) {
    btn.style.display = "none";
  }
}
