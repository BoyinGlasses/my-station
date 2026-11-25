import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgentEvent } from '../../server/agent-events.mjs';

test('Codex events are isolated from Claude sessions and tool names are understood', () => {
  const p = normalizeAgentEvent({ agent: 'codex', session_id: 'same', hook_event_name: 'PreToolUse', cwd: '/work', tool_name: 'shell_command', tool_input: { command: 'npm test' }, transcript_path: '/tmp/codex.jsonl' });
  assert.equal(p.session_id, 'codex:same');
  assert.equal(p.tool_name, 'Bash');
  assert.equal(p.tool_input.command, 'npm test');
  assert.equal(p.agent, 'codex');
  assert.equal(p.transcript_path, undefined);
});

test('Claude events remain compatible and unsupported agents are rejected', () => {
  const claude = { session_id: 'same', hook_event_name: 'Stop' };
  assert.deepEqual(normalizeAgentEvent(claude), claude);
  assert.equal(normalizeAgentEvent({ agent: 'unknown', session_id: 's', hook_event_name: 'Stop' }), null);
  assert.equal(normalizeAgentEvent({ agent: 'codex', session_id: '', hook_event_name: 'Stop' }), null);
});

test('Antigravity native hook payloads become isolated tool events', () => {
  const event = normalizeAgentEvent({ agent: 'antigravity', hook_event_name: 'PostToolUse', conversationId: 'c1', workspacePaths: ['/work'], toolCall: { name: 'run_command', args: { CommandLine: 'npm test' } }, error: 'failed' });
  assert.equal(event.session_id, 'antigravity:c1');
  assert.equal(event.cwd, '/work');
  assert.equal(event.tool_name, 'Bash');
  assert.equal(event.tool_input.command, 'npm test');
  assert.equal(event.hook_event_name, 'PostToolUseFailure');
});
