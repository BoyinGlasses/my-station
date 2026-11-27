import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChatEngine } from '../../src/shared/chat-engine.js';
import { createT } from '../../src/i18n/index.js';

function makeEngine(initialNow = Date.UTC(2026, 9, 5, 9, 0)) {
  let now = initialNow;
  let saved = null;
  const events = [];
  const engine = createChatEngine({
    tr: createT('en'),
    now: () => now,
    members: () => [{ id: 's1', name: 'Api', status: 'rest', task: '' }],
    staffName: (k) => (k === '__hr' ? 'HR' : null),
    store: { load: () => saved, save: (d) => { saved = d; } },
    emit: (op, payload) => events.push({ op, payload }),
    timer: () => 0,
  });
  return { engine, events, setNow: (t) => { now = t; }, getSaved: () => saved };
}

test('createChatEngine handles reactions, polls, pins, recalls, and key dedupe', () => {
  const { engine } = makeEngine();
  assert.equal(engine.state.msgs.length, 1);   // initial created system line
  assert.equal(engine.fresh('k1'), true);
  assert.equal(engine.fresh('k1'), false);

  engine.say('me', 'hello team', { now: true });
  const msg = engine.state.msgs.at(-1);
  engine.react(msg.id, 's1', '👍');
  assert.deepEqual(msg.reacts['👍'], ['s1']);
  engine.react(msg.id, 's1', '👍');   // toggle off
  assert.equal(msg.reacts['👍'], undefined);

  engine.pin(msg.id, 'Boss');
  assert.equal(engine.state.pinned, msg.id);
  engine.recall(msg.id);
  assert.equal(msg.recalled, true);
  assert.equal(engine.state.pinned, null);

  engine.poll('me', 'Lunch?', ['Pho', 'Banh mi'], 'poll-1');
  const p = engine.state.msgs.find((m) => m.kind === 'poll');
  engine.vote(p.id, 'me', 0);
  assert.deepEqual(p.poll.opts[0].by, ['me']);
  engine.vote(p.id, 'me', 1);
  assert.deepEqual(p.poll.opts[0].by, []);
  assert.deepEqual(p.poll.opts[1].by, ['me']);
});

test('weekly reminders roll forward by 7 days and clear RSVPs while one-off reminders finish', () => {
  const t0 = Date.UTC(2026, 9, 5, 8, 50);
  const dueAt = Date.UTC(2026, 9, 5, 9, 0);
  const { engine, setNow } = makeEngine(t0);

  engine.remind('hr', 'Weekly standup', dueAt, 'week', 'rem-week');
  engine.remind('hr', 'One-off demo', dueAt, '', 'rem-once');
  const weekly = engine.state.msgs.find((m) => m.remind?.title === 'Weekly standup');
  const once = engine.state.msgs.find((m) => m.remind?.title === 'One-off demo');
  engine.rsvp(weekly.id, 'me', true);
  assert.deepEqual(weekly.remind.yes, ['me']);

  // Jump 10 days ahead: weekly reminder must roll past now (2 weeks forward) and stay active
  setNow(dueAt + 10 * 86400e3);
  engine.clock();
  assert.equal(weekly.remind.done, undefined);
  assert.equal(weekly.remind.at, dueAt + 14 * 86400e3);
  assert.deepEqual(weekly.remind.yes, []);
  assert.equal(once.remind.done, true);
});
