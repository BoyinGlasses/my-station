// Office-owned runs use each CLI's interactive protocol so permissions can be answered in the office.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { normalizeTool } from './agent-events.mjs';

export function stopProcess(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  if (process.platform === 'win32' && proc.pid) {
    const killer = spawn('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    killer.on('error', () => { try { proc.kill(); } catch { /* already gone */ } });
    killer.on('exit', (code) => { if (code) try { proc.kill(); } catch { /* already gone */ } });
  } else { try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill(); } catch { /* already gone */ } } }
}

export function createAgentRpc(bin, args, { cwd, env, onNotify, onRequest, onClose } = {}) {
  const child = spawn(bin.file, [...(bin.args || []), ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
  const exited = new Promise((resolve) => child.once('close', resolve));
  const pending = new Map(); let seq = 0, buf = '', stderr = '', closed = false;
  const send = (msg) => { if (closed) return; child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n'); };
  const finish = (error) => {
    if (closed) return; closed = true;
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(error || new Error('Agent connection closed')); }
    pending.clear(); onClose?.(error);
  };
  child.stdin.on('error', (e) => finish(e));
  child.on('error', (e) => finish(e));
  child.on('close', (code) => finish(new Error(stderr.trim().split('\n').pop() || `Agent exited (${code})`)));
  child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-3000); });
  child.stdout.on('data', (c) => {
    buf += c;
    if (buf.length > 4_000_000) { finish(new Error('Agent output exceeded the limit')); stopProcess(child); return; }
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.method && Object.hasOwn(m, 'id')) {
        Promise.resolve().then(() => onRequest?.(m.method, m.params)).then((result) => {
          send(result === undefined ? { id: m.id, error: { code: -32601, message: 'Client method not supported' } } : { id: m.id, result });
        }).catch(() => send({ id: m.id, error: { code: -32603, message: 'Client request failed' } }));
      } else if (m.method) onNotify?.(m.method, m.params);
      else if (pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer);
        if (m.error) p.reject(new Error(m.error.message || 'Agent request failed')); else p.resolve(m.result);
      }
    }
  });
  return { child, notify: (method, params) => send({ method, params }),
    request(method, params, timeout = 30000) {
      if (closed) return Promise.reject(new Error('Agent connection closed'));
      return new Promise((resolve, reject) => {
        const id = ++seq, timer = timeout ? setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeout) : null;
        pending.set(id, { resolve, reject, timer }); send({ id, method, params });
      });
    }, close() { finish(); stopProcess(child); return exited; } };
}

export function runAgent(t, { onEvent, onStep, onPermission, onDone }) {
  const codex = t.agent === 'codex', calls = new Map(), messages = new Map();
  let done = false, events = Promise.resolve(), turnResolve, turnReject;
  const turn = new Promise((resolve, reject) => { turnResolve = resolve; turnReject = reject; });
  // A process can fail before the initialization handshake finishes.
  turn.catch(() => {});
  const emit = (hook_event_name, extra = {}) => {
    const event = { agent: t.agent, session_id: t.sid, cwd: t.dir, hook_event_name, office_task: t.id, ...extra };
    events = events.then(() => onEvent?.(t, event)).catch(() => {});
  };
  const step = (id, title, raw, kind = '') => {
    const tool = normalizeTool(t.agent, kind === 'execute' ? 'Bash' : kind === 'edit' ? 'Edit' : title, raw || {});
    calls.set(id, tool); onStep?.(t, { name: tool.name, input: tool.input });
    emit('PreToolUse', { tool_name: tool.name, tool_input: tool.input });
  };
  const rpc = createAgentRpc(t.bin, [codex ? 'app-server' : 'acp'], { cwd: t.dir, env: t.env,
    onClose: (e) => { if (!done) turnReject(e || new Error('Agent disconnected')); },
    onRequest: async (method, p) => {
      if (!t.sid || t.stopped || (p?.sessionId && p.sessionId !== t.sid) || (p?.threadId && p.threadId !== t.sid)) return undefined;
      if (method === 'session/request_permission') {
        const call = p.toolCall || {}, tool = normalizeTool(t.agent, call.kind === 'execute' ? 'Bash' : call.kind === 'edit' ? 'Edit' : call.title, call.rawInput || {});
        const allow = p.options?.find((o) => o.kind === 'allow_once'), deny = p.options?.find((o) => o.kind === 'reject_once');
        const yes = allow && await onPermission?.(t, { tool: tool.name, input: tool.input });
        const choice = yes && !t.stopped ? allow : deny;
        return { outcome: choice ? { outcome: 'selected', optionId: choice.optionId } : { outcome: 'cancelled' } };
      }
      if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
        const shell = method.includes('commandExecution'), yes = await onPermission?.(t, { tool: shell ? 'Bash' : 'Edit', input: shell ? { command: p.command || p.reason || '' } : { file_path: p.grantRoot || '', reason: p.reason || '' } });
        return { decision: yes && !t.stopped ? 'accept' : 'decline' };
      }
      if (method === 'item/tool/requestUserInput') {
        if (!Array.isArray(p.questions) || p.questions.some((q) => q.isSecret)) return { answers: {} };
        return { answers: await onPermission?.(t, { kind: 'ask', questions: p.questions }) || {} };
      }
      if (method === 'item/permissions/requestApproval') return { permissions: {}, scope: 'turn' };
      // Never grant persistent permissions or answer unsupported client tools on the user's behalf.
      return undefined;
    },
    onNotify: (method, p) => {
      if (done || t.stopped) return;
      if (codex) {
        if (p?.threadId !== t.sid) return;
        if (method === 'turn/started') t.turnId = p.turn?.id;
        if (method === 'item/completed') {
          const item = p.item || {};
          if (item.type === 'agentMessage') { messages.set(item.id, String(item.text || '')); t.result = [...messages.values()].join('\n').slice(0, 120000); }
          if (item.type === 'commandExecution') { step(item.id, 'Bash', { command: item.command }); emit(item.exitCode ? 'PostToolUseFailure' : 'PostToolUse', { tool_name: 'Bash', tool_input: { command: item.command } }); }
        }
        if (method === 'turn/completed') {
          if (p.turn?.status === 'failed') t.error = p.turn.error?.message || 'Agent turn failed';
          if (p.turn?.status === 'interrupted') t.stopped = true;
          turnResolve();
        }
        return;
      }
      if (method !== 'session/update' || p?.sessionId !== t.sid) return;
      const u = p.update || {};
      if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') t.result = (t.result + u.content.text).slice(0, 120000);
      if (u.sessionUpdate === 'tool_call') step(u.toolCallId, u.title, u.rawInput, u.kind);
      if (u.sessionUpdate === 'tool_call_update' && ['completed', 'failed'].includes(u.status)) {
        const tool = calls.get(u.toolCallId); calls.delete(u.toolCallId);
        if (tool) emit(u.status === 'failed' ? 'PostToolUseFailure' : 'PostToolUse', { tool_name: tool.name, tool_input: tool.input });
      }
    },
  });
  t.proc = rpc.child; t.pid = rpc.child.pid;
  t.cancel = async () => {
    try {
      if (t.sid) {
        if (codex && t.turnId) await rpc.request('turn/interrupt', { threadId: t.sid, turnId: t.turnId }, 1500);
        else rpc.notify('session/cancel', { sessionId: t.sid });
      }
    } catch { /* close a failed connection too */ }
    turnResolve(); await rpc.close();
  };
  (async () => {
    try {
      const init = await rpc.request('initialize', codex ? { clientInfo: { name: 'my_office', version: '0.6.0' }, capabilities: {} }
        : { protocolVersion: 1, clientInfo: { name: 'my-office', version: '0.6.0' }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
      if (t.stopped) return;
      if (codex) {
        rpc.notify('initialized');
        const method = !t.from?.sid ? 'thread/start' : t.from.fork ? 'thread/fork' : 'thread/resume';
        const r = await rpc.request(method, { ...(t.from?.sid ? { threadId: t.from.sid } : {}), cwd: t.dir, ...(t.model ? { model: t.model } : {}), approvalPolicy: 'on-request', approvalsReviewer: 'user', ...(t.system ? { developerInstructions: t.system } : {}) });
        t.sid = r.thread?.id;
        if (!t.sid) throw new Error('Agent did not return a session ID');
        emit('SessionStart'); emit('UserPromptSubmit', { prompt: t.text });
        const input = [{ type: 'text', text: t.text, text_elements: [] }, ...t.files.map((p) => ({ type: 'localImage', path: p }))];
        const started = await rpc.request('turn/start', { threadId: t.sid, input, ...(t.model ? { model: t.model } : {}) });
        t.turnId ||= started.turn?.id;
        await turn;
      } else {
        const caps = init.agentCapabilities || {}, sessionCaps = caps.sessionCapabilities || caps.session_capabilities || {};
        if (t.from?.sid && t.from.fork && !sessionCaps.fork) throw new Error('This agent cannot fork an existing conversation');
        const method = !t.from?.sid ? 'session/new' : t.from.fork ? 'session/fork' : 'session/load';
        const r = await rpc.request(method, { cwd: t.dir, mcpServers: [], ...(t.from?.sid ? { sessionId: t.from.sid } : {}) });
        t.sid = r.sessionId || (method === 'session/load' ? t.from.sid : null);
        if (!t.sid) throw new Error('Agent did not return a session ID');
        if (t.model) {
          const model = r.configOptions?.find((o) => o.category === 'model' || o.id === 'model');
          const legacy = r.models?.availableModels?.some((m) => m.modelId === t.model);
          if (model && !legacy) {
            const [value, variant] = t.agent === 'opencode' ? t.model.split('#') : [t.model];
            const updated = await rpc.request('session/set_config_option', { sessionId: t.sid, configId: model.id, value });
            if (variant) {
              const effort = updated.configOptions?.find((o) => o.category === 'thought_level' || o.id === 'effort');
              if (!effort) throw new Error('This agent does not expose a model variant setting');
              await rpc.request('session/set_config_option', { sessionId: t.sid, configId: effort.id, value: variant });
            }
          } else await rpc.request('session/set_model', { sessionId: t.sid, modelId: t.model });
        }
        if (t.stopped) return;
        emit('SessionStart'); emit('UserPromptSubmit', { prompt: t.text });
        if (t.files.length && !caps.promptCapabilities?.image) throw new Error('This agent does not accept image attachments');
        const prompt = [{ type: 'text', text: t.text }, ...t.files.map((p) => ({ type: 'image', mimeType: p.endsWith('.png') ? 'image/png' : p.endsWith('.webp') ? 'image/webp' : 'image/jpeg', data: fs.readFileSync(p).toString('base64') }))];
        const result = await rpc.request('session/prompt', { sessionId: t.sid, prompt }, 0);
        if (result.stopReason === 'cancelled') t.stopped = true;
        else if (!['end_turn', 'max_tokens', 'max_turn_requests', 'refusal'].includes(result.stopReason)) throw new Error(`Agent stopped: ${result.stopReason || 'unknown'}`);
      }
    } catch (e) { if (!t.stopped) t.error = String(e.message || e).slice(0, 1000); }
    finally {
      done = true;
      if (t.sid) emit(t.error ? 'StopFailure' : 'Stop', { last_assistant_message: t.result, ...(t.error ? { error: t.error } : {}) });
      await events; await rpc.close(); onDone(t);
    }
  })();
}
