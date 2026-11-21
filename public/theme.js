// Set data-theme before first paint so the persisted preference applies before React mounts and no dark flash shows.
(function () {
  try {
    var raw = localStorage.getItem('zpl-designer-session');
    var parsed = raw ? JSON.parse(raw) : null;
    var stored = parsed && parsed.state && parsed.state.theme;
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) { /* fall through to dark default in CSS */ }
})();
