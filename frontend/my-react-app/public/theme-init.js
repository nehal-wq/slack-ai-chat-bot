// Runs before the app renders so dark-mode users don't see a white flash.
// Mirrors ThemeProvider: saved choice ("light" | "dark" | "system").
(function () {
  var mode = "system";
  try {
    mode = localStorage.getItem("ui.theme") || "system";
  } catch {
    // Storage unavailable: follow the system setting
  }
  var dark =
    mode === "dark" ||
    (mode !== "light" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
})();
