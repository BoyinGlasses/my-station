// Safe URL and shell-quoting helpers shared across office UI views.
export function safeHttpUrl(u) {
  if (typeof u !== 'string') return '';
  const s = u.trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

export function quoteShellArg(s) {
  const v = String(s || '');
  if (!v) return "''";
  if (/^[A-Za-z0-9_./:~\\-]+$/.test(v)) return v;
  return `"${v.replace(/(["\\$`])/g, '\\$1')}"`;
}
