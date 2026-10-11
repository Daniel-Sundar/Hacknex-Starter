// Runs before the app paints, so a light-theme visitor never sees a dark flash. A file (not inline) so the
// Content-Security-Policy can forbid inline scripts.
try { if (localStorage.getItem("cs-theme") !== "dark") document.documentElement.dataset.theme = "light"; }
catch { document.documentElement.dataset.theme = "light"; }
