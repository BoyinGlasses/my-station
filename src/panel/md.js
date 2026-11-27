// A small markdown reader for a plan in the narrow panel. Delegates to src/shared/md.js
// with text-only links and flat lists so the panel stays light and self-contained.
import { el } from './fmt.js';
import { renderMarkdown } from '../shared/md.js';

export function planBlocks(text) {
  return renderMarkdown(text, {
    simple: true,
    links: 'text',
    tables: false,
    listMode: 'flat-panel',
    quotes: 'strip',
    joinParagraph: 'space',
    heading: (_lvl, s, inline) => { const h = el('h4'); inline(h, s); return h; },
    codeBlock: (_lang, body) => el('pre', null, body),
  });
}
