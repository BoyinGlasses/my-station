// The live connection: sessions, desks, teams, events.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { state } from '../core/state.js';
import { $, el, replay, short } from '../core/env.js';
import { scene } from '../scene/renderer.js';
import { CHAIR_IDLE, DESKS, PODS, UNITS, chairs, unitOfDesk } from '../world/desks.js';
import { canvasTex } from '../scene/blocks.js';
import { DEPTS } from '../world/layout.js';
import { DEPT_SIGNS } from '../world/pro/wing.js';
import { PALETTE, addWorker, dn, dropSub, hash, leaving, leavingIds, sessions, spawnSub, subs, trimLeaving, workers } from '../people/workers.js';
import { addFeed, queueFeed, queueUi, renderFeed, toast } from '../ui/activity.js';
import { closeSession, drM } from '../ui/session-drawer.js';
import { acctLogin, acctMoved, acctSwitched, limitWarned, liveWindows, loadMac, renderLimits, renderMac } from '../ui/mac-drawer.js';
import { renderAi, setAi } from '../ui/ai-accounts.js';
import { onTodos } from '../ui/whiteboard.js';
import { chatAct, chatApply, chatLeft, chatLoad } from '../ui/group-chat.js';
import { setTrophies } from '../life/trophies.js';
import { setLiftService } from '../life/lift-service.js';
import { onEvent } from '../life/incidents.js';
import { onPerm, perms, renderPerms, reportPresence } from '../ui/permissions.js';
import { renderPhone } from '../ui/topbar.js';
import { setTenure } from '../people/farewell.js';
import { t as tr } from '../../i18n/index.js';
import { projectOf } from '../../shared/path-label.js';

export let TOKEN;
export function setConn(on) { const c = $('conn'); c.dataset.state = on ? 'on' : 'off'; c.lastElementChild.textContent = tr(on ? 'activity.live.on' : 'activity.live.off'); }
/* Teams: each project (its git repository, else its folder) has an area of its own: half a pod on the open floor, a
   department room on the headquarters' wing, a row in the small office. A session sits in its project's area (the
   server's desk number is ignored); a project with more people than desks there takes the other half of the pod, or
   the nearest free area. Areas are remembered on this device, so a project comes back to the same desks tomorrow; an
   area someone else remembers is the last one handed to a newcomer. Only when every area is taken do projects share. */
const deskOf = new Map(), rowTeam = new Map();
const projOf = (s) => projectOf(s, tr('activity.live.otherProject'));
// partners sit face to face across a pod's screen (back-left, then front-right…): one faces the camera, the other's
// screens do; a room fills its first pod before the second
const SEAT_ORDER = [0, 3, 1, 2, 4, 7, 5, 6];
const AREAS_KEY = 'office-areas';
/** the area a project last had on this device (people/farewell.js), or -1 */
export const areaOf = (proj) => { const u = homes[proj]?.[0]; return u != null && u < UNITS.length ? u : -1; };
export { projOf };
let homes = {};   // project -> [area, …] it had, latest first (localStorage)
try { homes = JSON.parse(localStorage.getItem(AREAS_KEY) || '{}') || {}; } catch { /* storage blocked */ }
function remember(proj, u) {
  homes[proj] = [u, ...(homes[proj] || []).filter((x) => x !== u)].slice(0, 3);
  const keep = Object.keys(homes).slice(-24);   // (the 24 projects seen last)
  homes = Object.fromEntries(keep.map((k) => [k, homes[k]]));
  try { localStorage.setItem(AREAS_KEY, JSON.stringify(homes)); } catch { /* storage blocked */ }
}
const near = (a, b) => { const A = UNITS[a], B = UNITS[b]; return A.pod != null && B.pod != null ? Math.abs(A.pod - B.pod) * 2 + (A.side === B.side ? 0 : 1) : Math.abs(a - b); };
function proDesk(s) {
  if (deskOf.has(s.id)) return deskOf.get(s.id);
  const used = new Set(deskOf.values()), proj = projOf(s);
  const order = (u) => (UNITS[u].desks.length > 4 ? SEAT_ORDER.slice(0, UNITS[u].desks.length) : UNITS[u].desks.map((_, k) => k));
  const free = (u) => order(u).map((k) => UNITS[u].desks[k]).filter((d) => !used.has(d));
  const empty = (u) => free(u).length === UNITS[u].desks.length;
  const all = UNITS.map((_, u) => u), mine = all.filter((u) => rowTeam.get(u) === proj);
  const claim = (u) => { rowTeam.set(u, proj); remember(proj, u); return free(u)[0]; };
  let d = -1;
  const room = mine.find((u) => free(u).length);   // 1. its area, a desk free
  if (room != null) d = free(room)[0];
  if (d < 0) { const u = (homes[proj] || []).find((x) => x < UNITS.length && empty(x)); if (u != null) d = claim(u); }   // 2. where it sat before
  if (d < 0) {   // 3. a free area: next to its own, else one nobody calls home
    const claimed = new Set(Object.entries(homes).filter(([p]) => p !== proj).flatMap(([, us]) => us));
    const pick = all.filter(empty).sort((a, b) => (mine.length ? Math.min(...mine.map((m) => near(a, m))) - Math.min(...mine.map((m) => near(b, m))) : 0) || (claimed.has(a) - claimed.has(b)) || a - b)[0];
    if (pick != null) d = claim(pick);
  }
  if (d < 0) { let best = -1, most = 0; for (const u of all) if (free(u).length > most) { most = free(u).length; best = u; } if (best >= 0) d = free(best)[0]; }   // 4. every area taken: share
  deskOf.set(s.id, d);
  return d;
}
export function freeDesk(id) {
  if (!deskOf.has(id)) return;
  const d = deskOf.get(id); deskOf.delete(id);
  if (d >= 0 && ![...deskOf.values()].some((x) => x >= 0 && unitOfDesk[x] === unitOfDesk[d])) rowTeam.delete(unitOfDesk[d]);
}
export let teamTags;
export function updateTeamTags() {
  if (!teamTags) return;
  const here = teamTags.map((_, u) => [...sessions.values()].filter((s) => s.desk >= 0 && unitOfDesk[s.desk] === u));
  const nameOf = (u) => rowTeam.get(u) || [...new Set(here[u].map(projOf))][0] || '';
  teamTags.forEach((tg, u) => {
    // both halves of a pod with one project: one chip for the pod (on the first half), both carpets
    const twin = UNITS[u].pod != null ? u ^ 1 : -1, joined = twin >= 0 && here[twin].length && nameOf(twin) === nameOf(u);
    const people = joined ? [...here[u], ...here[twin]] : here[u];
    const projs = [...new Set(people.map(projOf))], name = nameOf(u), chip = here[u].length && !(joined && twin < u);
    const key = here[u].length ? `${name}|${projs.length}|${people.length}|${chip}` : '';
    if (key === tg.key) return; tg.key = key; tg.o.visible = !!chip; if (tg.rug) tg.rug.visible = !!here[u].length;
    const dept = UNITS[u].dept; if (dept >= 0) DEPT_SIGNS[dept]?.(here[u].length ? name : '');   // the room's door plaque
    if (!here[u].length) return;
    const colour = PALETTE[hash(name) % PALETTE.length];
    tg.rug?.material.color.set(colour);
    if (joined && twin < u) return;
    if (joined) tg.o.position.x = (DESKS[UNITS[u].desks[0]].x + DESKS[UNITS[twin].desks[0]].x) / 2 + 1.72 * Math.sign(DESKS[UNITS[twin].desks[0]].x - DESKS[UNITS[u].desks[0]].x);
    else if (UNITS[u].pod != null) tg.o.position.x = PODS[UNITS[u].pod][0] + 1.72 * UNITS[u].side;
    tg.txt.textContent = tr('activity.live.team', { name, more: projs.length > 1 ? ` +${projs.length - 1}` : '', n: people.length });
    tg.dot.style.background = colour;
    tg.o.element.title = projs.length > 1 ? tr('activity.live.teamShared', { name, others: projs.slice(1).join(', ') }) : tr('activity.live.teamTitle', { name });
  });
}
export function upsertSession(s, walkIn = true) {
  // (no 3D yet, the 2D list opened first: no desk and nobody at it; core/world-boot.js seats everyone once it is built)
  if (!state.world) { s.desk = -1; sessions.set(s.id, s); queueUi(); return; }
  s.desk = proDesk(s);   // (every layout: the project's area)
  const had = sessions.has(s.id);
  sessions.set(s.id, s);
  let w = workers.get(s.id);
  if (!w && !leavingIds.has(s.id)) w = addWorker(s, walkIn && had === false && state.connectedOnce);
  if (w) {
    w.setName(short(dn(s), 26));
    const live = new Set((s.subs || []).map((x) => x.id));
    for (const [aid, sw] of subs) if (sw.parent === w && !live.has(aid)) dropSub(aid);
    for (const x of s.subs || []) { if (!subs.has(x.id)) spawnSub(w, x.id, x.type); const sw = subs.get(x.id); if (sw && x.desc) sw.desc = x.desc; sw?.setModel(x.model); }
    w.setTeam([...subs.values()].filter((x) => x.parent === w).length);
    w.setAcct(s.acct);
    w.setStuck(s.stuck);
  }
  queueUi();
}
export function removeSession(id) {
  const s = sessions.get(id); sessions.delete(id); freeDesk(id);
  const w = workers.get(id);
  if (w) {
    workers.delete(id); leavingIds.add(id); leaving.add(w); trimLeaving();
    for (const [aid, sw] of subs) if (sw.parent === w) dropSub(aid, false);   // the boss is leaving: no report
    w.leave(() => leavingIds.delete(id));
  }
  if (s && s.desk >= 0) chairs[s.desk].color.set(CHAIR_IDLE);
  if (state.selectedId === id) closeSession();
  queueUi();
}

/* each area's carpet: a border in the project's colour round its desks, on the pod's grey tiles (none for a
   department room, which has its own door plaque) */
let rugTex;
function areaRug(u) {
  if (u.dept >= 0) return null;
  rugTex ||= canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 2; g.strokeRect(15, 15, w - 30, h - 30);
  });
  const xs = u.desks.map((d) => DESKS[d].x), zs = u.desks.map((d) => DESKS[d].z);
  const x0 = Math.min(...xs) - 0.82, x1 = Math.max(...xs) + 0.82, z0 = Math.min(...zs) - 0.62, z1 = Math.max(...zs) + 0.62;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: rugTex, transparent: true, depthWrite: false, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 }));
  m.position.set((x0 + x1) / 2, 0.012, (z0 + z1) / 2); m.visible = false; m.receiveShadow = true; m.userData.dynamic = true; scene.add(m);
  return m;
}

export function dropSessionNow(id) {
  const s = sessions.get(id); sessions.delete(id); freeDesk(id);
  const w = workers.get(id);
  if (w) { workers.delete(id); for (const [aid, sw] of subs) if (sw.parent === w) { subs.delete(aid); sw.remove(); } w.remove(); }
  if (s && s.desk >= 0) chairs[s.desk].color.set(CHAIR_IDLE);
  if (state.selectedId === id) closeSession();
}

// a newer office than this page (it was updated and restarted): load it, once nothing typed would be lost
function reloadSoon() {
  const typing = () => document.activeElement?.matches?.('input, textarea') || [...document.querySelectorAll('textarea')].some((t) => t.value.trim());
  if (typing()) { setTimeout(reloadSoon, 5000); return; }
  location.reload();
}
// a translation that arrived after its event: swap the words in bubbles, the feed and the session list
function relabel(from, to) {
  if (!from || !to) return;
  for (const w of [...workers.values(), ...subs.values()]) if (w.lastSay?.text?.includes(from) && w.bubbleObj.visible) w.say(w.lastSay.type, w.lastSay.text.replace(from, to), w.lastSay.kind);
  for (const e of state.feed) { if (e.label === from) e.label = to; if (e.desc === from) e.desc = to; }
  for (const s of sessions.values()) for (const o of [s, ...(s.subs || [])]) { if (o.last?.label === from) o.last.label = to; if (o.desc === from) o.desc = to; }
  queueFeed(); queueUi();
}
// One handler for the live stream and for replays. `quiet` (fast-forwarding a replay) places people without walking
// and fills the feed without bubbles or animations.
export function applyMsg(d, quiet = false) {
  if (d.k === 'snap' || d.k === 'lang') {
    if (d.lang && d.lang !== document.documentElement.lang && !new URLSearchParams(location.search).has('lang')) { location.reload(); return; }
    if (d.k === 'lang') return;
  }
  if (d.k === 'snap') {
    const ids = new Set(d.sessions.map((s) => s.id));
    for (const id of [...sessions.keys()]) if (!ids.has(id)) (quiet ? dropSessionNow : removeSession)(id);
    for (const s of d.sessions) upsertSession(s, false);
    state.feed = d.feed || []; state.stats = d.stats || {}; renderFeed();
    if ('local' in d) {
      perms.clear(); for (const p of d.perms || []) perms.set(p.id, p); renderPerms(); reportPresence();
      if (!quiet) chatLoad();
      state.isLocal = !!d.local; state.lanUrl = d.lan || null; state.lanBase = d.lanBase || null; state.phonePin = d.pin || null; state.tsUrl = d.ts || null; state.tsHere = !!d.tsHere; state.phoneApprove = !!d.phoneApprove; state.phoneTasks = !!d.phoneTasks; state.lanFixed = !!d.lanFixed;
      if (d.build) { if (state.build && d.build !== state.build) reloadSoon(); else state.build = d.build; }
      state.todos = d.todos || []; onTodos();
      if (d.trophies) setTrophies(d.trophies);
      if (d.lift) setLiftService(d.lift);
      state.limits = d.limits || null; state.limitsNote = d.limitsNote || ''; for (const w of liveWindows()) if (w.pct >= 80) limitWarned.add(`${w.key}:${w.resetsAt}:${w.pct >= 95 ? 95 : 80}`); renderLimits();
      setAi(d.ai);
      $('btn-phone').hidden = false; if ($('btn-phone-top')) $('btn-phone-top').hidden = !state.isLocal;
      $('btn-bell').hidden = !('Notification' in window) || !window.isSecureContext;
    }
    state.connectedOnce = true; queueUi();
  } else if (d.k === 'sess') { upsertSession(d.s, !quiet); if (d.stats) state.stats = d.stats; }
  else if (d.k === 'gone') { if (!quiet) chatLeft(sessions.get(d.id)); (quiet ? dropSessionNow : removeSession)(d.id); }
  else if (d.k === 'ev') {
    if (d.stats) state.stats = d.stats; upsertSession(d.s, !quiet);
    if (!quiet) onEvent(d.e); else if (!d.e.quiet && d.e.type !== 'start') addFeed(d.e);
  }
  else if (d.k === 'stats') { state.stats = d.stats; if (d.s) upsertSession(d.s, !quiet); }
  else if (d.k === 'perm') onPerm(d.p);
  else if (d.k === 'permDone') { perms.delete(d.id); renderPerms(); }
  else if (d.k === 'todos') { state.todos = d.todos || []; onTodos(); }
  else if (d.k === 'phone') { state.phoneApprove = !!d.approve; state.phoneTasks = !!d.tasks; for (const c of [...$('perm-stack').children]) c.remove(); renderPerms(); reportPresence(); if (!$('phone-modal').hidden) renderPhone(); }
  else if (d.k === 'acctlogin') acctLogin(d);
  else if (d.k === 'acctswitch') acctSwitched(d);
  else if (d.k === 'acctmove') { if (!quiet) acctMoved(d); }
  else if (d.k === 'chat') chatApply(d);
  else if (d.k === 'chatact') { if (!quiet) chatAct(d.what); }
  else if (d.k === 'limits') { state.limits = d.limits || null; state.limitsNote = d.note || ''; renderLimits(); renderAi(); if (!drM.hidden) renderMac(); }
  else if (d.k === 'ai') setAi(d.ai);
  else if (d.k === 'sysauto') { if (!quiet) { toast(d.message, 8000); loadMac(); } }
  else if (d.k === 'trophies') setTrophies(d.t, quiet ? [] : d.earned || []);
  else if (d.k === 'tenure') setTenure(d);
  else if (d.k === 'vi') relabel(d.from, d.to);
}

export let liveES = null;
const VIA_TUNNEL = typeof location !== 'undefined' && /\.trycloudflare\.com$/.test(location.hostname);
function ask() {
  const stop = new AbortController();
  liveES = { close: () => stop.abort() };
  (async () => {
    let since = -1, fails = 0;
    while (!stop.signal.aborted) {
      if (document.hidden) await new Promise((ok) => document.addEventListener('visibilitychange', ok, { once: true }));
      try {
        const r = await fetch(`/api/live?since=${since}${TOKEN ? `&k=${encodeURIComponent(TOKEN)}` : ''}`, { cache: 'no-store', signal: stop.signal });
        if (r.status === 401) { location.reload(); return; }
        const j = await r.json();
        fails = 0; setConn(true); since = j.seq;
        if (!replay.on) for (const d of j.msgs) applyMsg(d);
      } catch {
        if (stop.signal.aborted) return;
        setConn(false); await new Promise((ok) => setTimeout(ok, Math.min(15_000, 1000 * 2 ** fails++)));
      }
    }
  })();
}
export function connect() {
  if (VIA_TUNNEL) { ask(); return; }
  const es = new EventSource(`/stream${TOKEN ? `?k=${encodeURIComponent(TOKEN)}` : ''}`);
  liveES = es;
  es.onopen = () => setConn(true);
  es.onerror = () => setConn(false);
  es.onmessage = (m) => {
    if (replay.on) return;
    let d; try { d = JSON.parse(m.data); } catch { return; }
    applyMsg(d);
  };
}

export function setup() {
  /* ---------- live connection ---------- */
  TOKEN = new URLSearchParams(location.search).get('k') || '';
  state.connectedOnce = false;
}
// (part of the 3D world: main.js runs it with the world)
export function setupTeams() {
  // a name chip over each team's pod (a department room: over the gap between its two pods): "Team website-ielts · 3"
  teamTags = UNITS.map((u) => {
    const t = el('div', 'team-tag'); const dot = el('i'), txt = el('span'); t.append(dot, txt);
    const o = new CSS2DObject(t);
    if (u.dept >= 0) o.position.set(DEPTS[u.dept].cx, 1.5, DEPTS[u.dept].cz);
    else if (u.pod != null) o.position.set(PODS[u.pod][0] + 1.72 * u.side, 1.3, PODS[u.pod][1]);
    else o.position.set(Math.max(...u.desks.map((d) => DESKS[d].x)) + 1.05, 1.3, DESKS[u.desks[0]].z);   // (the small office: at the end of the row)
    o.visible = false; scene.add(o);
    return { o, dot, txt, key: '', rug: areaRug(u) };
  });
}
