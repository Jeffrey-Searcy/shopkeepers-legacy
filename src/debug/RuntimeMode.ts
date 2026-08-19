/** Shared runtime-mode guard used by the test seam and dev-only in-game tools. */
export function isTestMode(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('test') === '1' || import.meta.env.DEV;
}

/** Normal play shows the title; deterministic specs keep direct Farm boot unless `menu=1`. */
export function shouldShowMainMenu(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('test') !== '1' || params.get('menu') === '1';
}
