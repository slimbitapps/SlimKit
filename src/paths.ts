/** Pfad-Helfer für die Oberfläche (Windows und Mac) */
export const sep = () => (window.api.platform === 'win32' ? '\\' : '/');
export const join = (a: string, b: string) => (a.endsWith(sep()) ? a + b : a + sep() + b);
export const dirname = (p: string) => p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))) || p;
export const basename = (p: string) => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
export const extname = (p: string) => {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
};
