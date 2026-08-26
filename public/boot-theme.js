(() => {
  const key = 'opentig.theme';
  let theme = null;
  try { theme = localStorage.getItem(key); } catch { /* private mode */ }
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = theme === 'light' ? false : theme === 'dark' ? true : prefersDark;
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.classList.toggle('light', !dark);
})();
