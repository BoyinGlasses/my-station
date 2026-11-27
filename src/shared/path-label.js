// Cross-platform project/folder label and accent-folding helpers (splits both / and \).
export const baseName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
export const projectOf = (s, fallback = '') => s?.git?.repo || baseName(s?.dir) || fallback;
export const folderOf = (p) => {
  const parts = String(p || '').split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join('/') || String(p || '');
};
export const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
