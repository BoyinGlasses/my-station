import fs from 'node:fs';
import readline from 'node:readline';

export async function serveFakeAgent({ agent, sid = 'owned', answer = 'done', capture, permission = false } = {}) {
  const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  let start, model, waiting, promptText;
  const requests = [];
  const complete = (q) => {
    const failed = promptText.includes('simulate failure');
    if (agent === 'codex') {
      send({ method: 'item/completed', params: { threadId: sid, turnId: 'turn-1', item: { id: 'answer-1', type: 'agentMessage', text: failed ? 'partial answer' : answer } } });
      send({ method: 'turn/completed', params: { threadId: sid, turn: { id: 'turn-1', status: failed ? 'failed' : 'completed', ...(failed ? { error: { message: 'provider token=example-secret-value' } } : {}) } } });
    } else {
      send({ method: 'session/update', params: { sessionId: sid, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: answer } } } });
      send({ id: q.id, result: { stopReason: 'end_turn' } });
    }
  };
  for await (const line of readline.createInterface({ input: process.stdin })) {
    let q; try { q = JSON.parse(line); } catch { continue; }
    if (q.method) requests.push({ method: q.method, params: q.params });
    if (q.id === 'permission-1' || q.id === 'question-1') {
      if (capture) fs.appendFileSync(capture + (q.id === 'question-1' ? '.questions' : '.approvals'), JSON.stringify(q) + '\n');
      if (waiting) complete(waiting);
    } else if (q.method === 'initialize') send({ id: q.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { fork: {} }, promptCapabilities: { image: true } } } });
    else if (q.method === 'model/list') send({ id: q.id, result: { data: [{ model: 'custom-model', displayName: 'Custom' }], nextCursor: null } });
    else if (/^(thread\/(start|fork|resume)|session\/(new|fork|load))$/.test(q.method || '')) {
      start = q; model = q.params.model;
      send({ id: q.id, result: agent === 'codex' ? { thread: { id: sid } } : { sessionId: sid, configOptions: [{ id: 'model', category: 'model', type: 'select', currentValue: 'default', options: [] }] } });
    } else if (q.method === 'session/set_model') { model = q.params.modelId; send({ id: q.id, result: {} }); }
    else if (q.method === 'session/set_config_option') { if (q.params.configId === 'model') model = q.params.value; send({ id: q.id, result: { configOptions: [{ id: 'effort', category: 'thought_level', type: 'select', currentValue: 'default', options: [] }] } }); }
    else if (q.method === 'turn/interrupt' || q.method === 'session/cancel') {
      if (q.id) send({ id: q.id, result: {} });
      if (waiting) send({ id: waiting.id, result: { stopReason: 'cancelled' } });
    } else if (q.method === 'turn/start' || q.method === 'session/prompt') {
      promptText = (q.params.input || q.params.prompt).filter((p) => p.type === 'text').map((p) => p.text).join('\n');
      if (capture) fs.appendFileSync(capture, JSON.stringify({ args: process.argv.slice(2), start: { method: start.method, params: start.params }, text: promptText, model, prompt: q.params, requests }) + '\n');
      if (agent === 'codex') send({ id: q.id, result: { turn: { id: 'turn-1' } } });
      if (promptText === 'hang') { waiting = q; continue; }
      if (agent === 'codex' && promptText === 'ask question') {
        waiting = q;
        send({ id: 'question-1', method: 'item/tool/requestUserInput', params: { threadId: sid, turnId: 'turn-1', questions: [{ id: 'direction', header: 'Direction', question: 'Which direction?', options: [{ label: 'A', description: 'first' }, { label: 'B', description: 'second' }] }] } });
        continue;
      }
      if (permission || promptText === 'ask permission') {
        waiting = q;
        send(agent === 'codex'
          ? { id: 'permission-1', method: 'item/commandExecution/requestApproval', params: { threadId: sid, turnId: 'turn-1', itemId: 'tool-1', command: 'git push --force origin main' } }
          : { id: 'permission-1', method: 'session/request_permission', params: { sessionId: sid, toolCall: { title: 'run_command', kind: 'execute', rawInput: { command: 'git push --force origin main' } }, options: [{ optionId: 'once', kind: 'allow_once' }, { optionId: 'always', kind: 'allow_always' }, { optionId: 'no', kind: 'reject_once' }] } });
      } else complete(q);
    } else if (q.id) send({ id: q.id, error: { code: -32601, message: 'Unsupported method' } });
  }
}
