// Non-blocking EN -> VI translation helper with redaction-before-lookup and bounded disk cache.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const VI_CHARS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

export function createTranslator({ dataDir, redact, enabled = process.env.OFFICE_TRANSLATE !== '0', lang, onTranslated }) {
  const file = path.join(dataDir, 'vi-cache.json');
  let viCache = {};
  try { viCache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  let dirty = false;
  const flushTimer = setInterval(() => {
    if (!dirty) return;
    dirty = false;
    const keys = Object.keys(viCache);
    if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete viCache[k];
    fsp.writeFile(file, JSON.stringify(viCache)).catch(() => {});
  }, 15_000);
  flushTimer.unref?.();

  const wait = new Map();
  function fetchVi(text) {
    if (wait.has(text)) return wait.get(text);
    const job = (async () => {
      for (let k = 0; k < 3; k++) {
        try {
          const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=${encodeURIComponent(text)}`, { signal: AbortSignal.timeout(4000) });
          if (r.ok) {
            const j = await r.json();
            const out = (j?.[0] || []).map((x) => x?.[0] || '').join('').trim();
            if (out) { viCache[text] = out; dirty = true; return out; }
          }
        } catch { /* offline or rate-limited */ }
        await new Promise((res) => setTimeout(res, 1500 * (k + 1)));
      }
      return null;
    })().finally(() => wait.delete(text));
    wait.set(text, job);
    return job;
  }

  // Never blocks hook handling: returns redacted or cached text immediately, translating in the background.
  async function toVi(text) {
    text = redact(String(text || ''));
    if (!enabled || lang() !== 'vi' || !text || VI_CHARS.test(text) || !/[a-z]{3}/i.test(text)) return text;
    if (viCache[text]) return viCache[text];
    fetchVi(text).then((late) => {
      if (!late || late === text) return;
      onTranslated?.(text, late);
    }).catch(() => {});
    return text;
  }

  return { toVi, cached: (s) => viCache[s], stop: () => clearInterval(flushTimer) };
}
