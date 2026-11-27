// Pure DOM Markdown renderer (text nodes only, never innerHTML, safeHttpUrl for links).
// Shared by the 3D office session drawer, group chat view, and the lightweight editor/menubar panel.
import { safeHttpUrl } from './safe-url.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const MD_INLINE_FULL = /(`[^`\n]+`|\*\*[^*\n]+?\*\*|__[^_\n]+?__|(?<![\w*])\*[^*\s][^*\n]*?\*(?!\w)|\[[^\]\n]+\]\([^)\s]+\)|https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?])/;
const MD_INLINE_PANEL = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/;
const LIST_RE = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const HR_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const cellsOf = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function renderInline(parent, text, opts = {}) {
  const {
    links = 'open',          // 'open' | 'text'
    fileClass = 'md-file',
    shortUrl = null,
    strongTag = 'strong',
    emTag = 'em',
    simple = false,
  } = opts;
  const re = simple ? MD_INLINE_PANEL : MD_INLINE_FULL;
  for (const bit of String(text ?? '').split(re)) {
    if (!bit) continue;
    let m;
    if (bit.length > 2 && bit[0] === '`' && bit.at(-1) === '`') {
      parent.append(el('code', null, bit.slice(1, -1)));
    } else if (/^(\*\*|__).+\1$/.test(bit) && bit.length > 4) {
      const b = el(strongTag);
      if (simple) b.textContent = bit.slice(2, -2);
      else renderInline(b, bit.slice(2, -2), opts);
      parent.append(b);
    } else if (!simple && /^\*[^*].*\*$/.test(bit)) {
      const em = el(emTag);
      renderInline(em, bit.slice(1, -1), opts);
      parent.append(em);
    } else if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(bit))) {
      if (links === 'open') {
        const href = safeHttpUrl(m[2]);
        if (href) {
          const a = el('a', null, m[1]); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
          parent.append(a);
        } else if (fileClass) parent.append(el('span', fileClass, m[1]));
        else parent.append(m[1]);
      } else {
        parent.append(m[1]);
      }
    } else if (!simple && links === 'open' && /^https?:\/\//.test(bit)) {
      const href = safeHttpUrl(bit);
      if (href) {
        const label = shortUrl ? shortUrl(href) : href;
        const a = el('a', null, label); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
        parent.append(a);
      } else parent.append(bit);
    } else {
      parent.append(bit);
    }
  }
}

export function renderMarkdown(text, opts = {}) {
  const {
    tables = true,
    tableClass = 'md-table',
    taskLists = false,
    listMode = 'nested',     // 'nested' | 'flat-panel' | 'flat-sub'
    subItemClass = 'zc-md-sub',
    quotes = 'block',        // 'block' | 'line' | 'strip'
    quoteClass = 'zc-md-q',
    heading = null,          // (level, text, inlineFn) => Node
    codeBlock = null,        // (lang, body) => Node
    joinParagraph = 'br',    // 'br' | 'space'
  } = opts;
  const inline = (parent, s) => renderInline(parent, s, opts);
  const frag = document.createDocumentFragment();
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  let i = 0;

  const startsBlock = (l, next) =>
    /^\s*```/.test(l)
    || /^#{1,6}\s/.test(l)
    || LIST_RE.test(l)
    || (quotes !== 'strip' && /^\s*>/.test(l))
    || HR_RE.test(l)
    || (tables && /^\s*\|/.test(l) && TABLE_SEP_RE.test(next || ''));

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;

    if ((m = /^\s*```\s*([\w+#.-]*)/.exec(line))) {
      const code = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      const body = code.join('\n');
      if (codeBlock) frag.append(codeBlock(m[1] || '', body));
      else { const pre = el('pre'); pre.append(el('code', null, body)); frag.append(pre); }
      continue;
    }

    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      const clean = m[2].replace(/\s#+\s*$/, '');
      if (heading) frag.append(heading(m[1].length, clean, inline));
      else { const h = el(m[1].length <= 2 ? 'h4' : 'h5'); inline(h, clean); frag.append(h); }
      i++; continue;
    }

    if (HR_RE.test(line)) { frag.append(el('hr')); i++; continue; }

    if (tables && /^\s*\|/.test(line) && TABLE_SEP_RE.test(lines[i + 1] || '')) {
      const wrap = el('div', tableClass), t = el('table'), thead = el('thead'), trEl = el('tr');
      for (const c of cellsOf(line)) { const th = el('th'); inline(th, c); trEl.append(th); }
      thead.append(trEl); t.append(thead); i += 2;
      const tb = el('tbody');
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        if (!TABLE_SEP_RE.test(lines[i])) {
          const r = el('tr');
          for (const c of cellsOf(lines[i])) { const td = el('td'); inline(td, c); r.append(td); }
          tb.append(r);
        }
        i++;
      }
      t.append(tb); wrap.append(t); frag.append(wrap); continue;
    }

    if (quotes !== 'strip' && /^\s*>/.test(line)) {
      if (quotes === 'line') {
        const b = el('div', quoteClass);
        inline(b, line.replace(/^\s*>\s?/, ''));
        frag.append(b); i++; continue;
      }
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      const bq = el('blockquote'); bq.append(renderMarkdown(q.join('\n'), opts)); frag.append(bq); continue;
    }

    if (LIST_RE.test(line)) {
      if (listMode === 'flat-panel') {
        const ul = el('ul');
        while (i < lines.length && LIST_RE.test(lines[i])) {
          const lm = LIST_RE.exec(lines[i]), li = el('li');
          li.style.marginLeft = `${Math.min(3, Math.floor(lm[1].replace(/\t/g, '  ').length / 2)) * 12}px`;
          if (/\d/.test(lm[2])) li.dataset.n = lm[2];
          inline(li, lm[3]); ul.append(li); i++;
        }
        frag.append(ul); continue;
      }
      if (listMode === 'flat-sub') {
        let cur = null;
        while (i < lines.length && LIST_RE.test(lines[i])) {
          const lm = LIST_RE.exec(lines[i]), kind = /\d/.test(lm[2]) ? 'ol' : 'ul';
          if (!cur || cur.tagName.toLowerCase() !== kind) {
            cur = el(kind);
            if (kind === 'ol') cur.start = parseInt(lm[2], 10) || 1;
            frag.append(cur);
          }
          const li = el('li');
          if (lm[1].length >= 2) li.className = subItemClass;
          inline(li, lm[3]); cur.append(li); i++;
        }
        continue;
      }
      const stack = [];
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) { if (LIST_RE.test(lines[i + 1] || '')) { i++; continue; } break; }
        const lm = LIST_RE.exec(l);
        if (!lm) {
          if (/^\s+\S/.test(l) && stack.length) { const li = stack.at(-1).li; li.append(' '); inline(li, l.trim()); i++; continue; }
          break;
        }
        const indent = lm[1].replace(/\t/g, '  ').length, ordered = /\d/.test(lm[2]);
        while (stack.length && stack.at(-1).indent > indent) stack.pop();
        if (!stack.length || stack.at(-1).indent < indent) {
          const list = el(ordered ? 'ol' : 'ul');
          if (ordered && parseInt(lm[2], 10) > 1) list.start = parseInt(lm[2], 10);
          (stack.length ? stack.at(-1).li : frag).append(list);
          stack.push({ indent, list, li: null });
        }
        const top = stack.at(-1), li = el('li');
        const task = taskLists && /^\[( |x|X)\]\s+(.*)$/.exec(lm[3]);
        if (task) {
          li.className = 'md-task'; li.dataset.done = String(task[1] !== ' ');
          const span = el('span'); inline(span, task[2]);
          li.append(el('span', 'md-box', task[1] !== ' ' ? '✓' : ''), span);
        } else inline(li, lm[3]);
        top.list.append(li); top.li = li; i++;
      }
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !(para.length && startsBlock(lines[i], lines[i + 1]))) {
      para.push(quotes === 'strip' ? lines[i++].replace(/^\s*>\s?/, '') : lines[i++]);
    }
    const p = el('p');
    if (joinParagraph === 'space') inline(p, para.join(' '));
    else para.forEach((l, k) => { if (k) p.append(el('br')); inline(p, l); });
    frag.append(p);
  }
  return frag;
}
