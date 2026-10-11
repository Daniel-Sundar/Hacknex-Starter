// Runs before the app paints, so nobody sees the wrong theme flash. Follows the OS until the person picks a theme
// with the header button (then "cs-theme" holds their choice). A file, not inline, so the CSP can forbid inline scripts.
(function () {
  var pick = null;
  try { pick = localStorage.getItem("cs-theme"); } catch (e) { /* storage blocked */ }
  var dark = pick ? pick === "dark" : !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  if (!dark) document.documentElement.dataset.theme = "light";
})();
