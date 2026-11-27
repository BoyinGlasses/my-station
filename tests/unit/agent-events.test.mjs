import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgentEvent, normalizeTool } from '../../server/agent-events.mjs';

test('Codex events are isolated from Claude sessions and tool names are understood', () => {
  const p = normalizeAgentEvent({ agent: 'codex', session_id: 'same', hook_event_name: 'PreToolUse', cwd: '/work', tool_name: 'shell_command', tool_input: { command: 'npm test' }, transcript_path: '/tmp/codex.jsonl' });
  assert.equal(p.session_id, 'codex:same');
  assert.equal(p.tool_name, 'Bash');
  assert.equal(p.tool_input.command, 'npm test');
  assert.equal(p.agent, 'codex');
  assert.equal(p.transcript_path, undefined);

  const cmd = normalizeAgentEvent({ agent: 'codex', session_id: 's2', hook_event_name: 'PreToolUse', tool_name: 'exec_command', tool_input: { cmd: 'git status' } });
  assert.equal(cmd.tool_name, 'Bash');
  assert.equal(cmd.tool_input.command, 'git status');
});

test('normalizeTool does not coerce custom MCP tools with a command field to Bash', () => {
  const mcp = normalizeTool('codex', 'mcp__redis__exec', { command: 'GET key' });
  assert.equal(mcp.name, 'mcp__redis__exec');
  const grep = normalizeTool('antigravity', 'grep_search', { Query: 'authToken' });
  assert.equal(grep.name, 'Grep');
  assert.equal(grep.input.pattern, 'authToken');
  const glob = normalizeTool('antigravity', 'find_by_name', { Pattern: '*.mjs' });
  assert.equal(glob.name, 'Glob');
  assert.equal(glob.input.pattern, '*.mjs');
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
