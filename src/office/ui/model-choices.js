import { el } from '../core/env.js';
import { TOKEN } from '../net/live.js';
import { t as tr } from '../../i18n/index.js';

export function modelChoices(input) {
  const select = el('select', 'zc-model-list'); select.hidden = true; select.setAttribute('aria-label', tr('chat.task.selectModel'));
  const element = el('div', 'zc-model-choices'), status = el('small', 'zc-model-status'), retry = el('button', 'zc-model-retry', tr('chat.task.modelRetry'));
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); retry.type = 'button'; retry.hidden = true;
  element.append(select, status, retry);
  select.addEventListener('change', () => { input.value = select.value; input.dispatchEvent(new Event('input')); });
  let current = '', lastTarget;
  retry.addEventListener('click', () => load(lastTarget, true));
  async function load(target, force = false) {
    lastTarget = target;
    const query = new URLSearchParams();
    if (target?.sid) query.set('sid', target.sid);
    else if (target?.dir && target?.agent) { query.set('dir', target.dir); query.set('agent', target.agent); }
    else { select.hidden = true; status.textContent = ''; retry.hidden = true; current = ''; return; }
    if (TOKEN) query.set('k', TOKEN);
    const key = query.toString(); if (!force && key === current) return; current = key; select.hidden = true; retry.hidden = true;
    status.textContent = tr('chat.task.modelLoading');
    const result = await fetch(`/api/models?${query}`).then((r) => r.ok ? r.json() : null).catch(() => null);
    if (current !== key) return;
    if (!result?.ok || !Array.isArray(result.models)) { status.textContent = tr('chat.task.modelFailed'); retry.hidden = false; return; }
    if (!result.models.length) { status.textContent = tr('chat.task.modelEmpty'); retry.hidden = false; return; }
    status.textContent = result.source === 'cli-aliases' ? tr('chat.task.modelAliases') : '';
    const first = el('option', null, tr('chat.task.selectModel')); first.value = '';
    const options = result.models.map((m) => { const o = el('option', null, m.name === m.id ? m.id : `${m.name} (${m.id})`); o.value = m.id; return o; });
    select.replaceChildren(first, ...options); select.value = input.value; if (select.selectedIndex < 0) select.selectedIndex = 0; select.hidden = false;
  }
  return { select, element, load };
}
