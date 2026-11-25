// OpenCode's plugin API supplies lifecycle events independently of the model provider.
export const createOfficePlugin = (port = 4310) => async ({ directory }) => {
  const dirs = new Map(), statuses = new Map(), roles = new Map(), tools = new Map(), replies = new Map(), sentParts = new Set();
  const send = async (sid, hook_event_name, extra = {}) => {
    if (!sid) return;
    try {
      await fetch(`http://127.0.0.1:${port}/event`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'opencode', session_id: sid, hook_event_name, cwd: dirs.get(sid) || directory, ...extra }), signal: AbortSignal.timeout(500) });
    } catch { /* The office is optional and must never stop OpenCode. */ }
  };
  return {
    event: async ({ event }) => {
      const p = event?.properties || {}, sid = p.sessionID || p.info?.id;
      switch (event?.type) {
        case 'session.created': case 'session.updated':
          if (!sid) break;
          if (p.info?.directory) dirs.set(sid, p.info.directory);
          if (event.type === 'session.created') await send(sid, 'SessionStart');
          break;
        case 'session.deleted':
          await send(sid, 'SessionEnd'); dirs.delete(sid); statuses.delete(sid); replies.delete(sid); break;
        case 'session.next.prompt.admitted':
          if (typeof p.prompt?.text === 'string') await send(sid, 'UserPromptSubmit', { prompt: p.prompt.text });
          break;
        case 'message.updated':
          if (p.info?.id && p.info?.role) { roles.set(p.info.id, p.info.role); if (roles.size > 1000) roles.delete(roles.keys().next().value); }
          break;
        case 'message.part.updated': {
          const part = p.part, role = roles.get(part?.messageID), session = sid || part?.sessionID;
          if (part?.type !== 'text' || part.synthetic || !part.time?.end || !part.text || !session) break;
          if (role === 'assistant') replies.set(session, part.text);
          else if (role === 'user' && part.id && !sentParts.has(part.id)) {
            sentParts.add(part.id); if (sentParts.size > 1000) sentParts.delete(sentParts.values().next().value);
            await send(session, 'UserPromptSubmit', { prompt: part.text });
          }
          break;
        }
        case 'permission.asked': case 'question.asked':
          await send(sid, 'Notification', { notification_type: 'agent_needs_input' }); break;
        case 'permission.replied': case 'question.replied': case 'question.rejected':
          await send(sid, 'UserPromptSubmit'); break;
        case 'session.tool.input.started': {
          if (!sid || !p.id || !p.name) break;
          tools.set(`${sid}:${p.id}`, { name: p.name });
          if (tools.size > 1000) tools.delete(tools.keys().next().value);
          break;
        }
        case 'session.tool.called': {
          const tool = tools.get(`${sid}:${p.id}`);
          if (tool) { tool.input = p.input; await send(sid, 'PreToolUse', { tool_name: tool.name, tool_input: tool.input }); }
          break;
        }
        case 'session.tool.success': case 'session.tool.failed': {
          const key = `${sid}:${p.id}`, tool = tools.get(key);
          if (tool) { tools.delete(key); await send(sid, event.type === 'session.tool.failed' ? 'PostToolUseFailure' : 'PostToolUse', { tool_name: tool.name, tool_input: tool.input }); }
          break;
        }
        case 'session.text.ended':
          if (sid && typeof p.text === 'string') replies.set(sid, p.text);
          break;
        case 'session.idle': case 'session.status': {
          const status = event.type === 'session.idle' ? 'idle' : p.status?.type;
          if (sid && status && statuses.get(sid) !== status) {
            statuses.set(sid, status);
            if (status === 'idle') { await send(sid, 'Stop', { last_assistant_message: replies.get(sid) }); replies.delete(sid); }
            else if (status === 'busy') await send(sid, 'UserPromptSubmit');
          }
          break;
        }
        case 'session.error': await send(sid, 'StopFailure'); break;
      }
    },
    'tool.execute.before': async (input, output) => send(input.sessionID, 'PreToolUse', { tool_name: input.tool, tool_input: output.args }),
    'tool.execute.after': async (input) => send(input.sessionID, 'PostToolUse', { tool_name: input.tool, tool_input: input.args }),
  };
};

export const createOpenCode2Plugin = (port = 4310) => ({
  id: 'my-office',
  setup: async (ctx) => {
    if (!ctx?.session?.hook || !ctx?.event?.subscribe) return;
    const hooks = await createOfficePlugin(port)({ directory: '' });
    const controller = new AbortController();
    const known = new Set();
    const remember = async (sid) => {
      if (!sid || known.has(sid) || typeof ctx.session.get !== 'function') return;
      try {
        const info = await Promise.race([ctx.session.get({ sessionID: sid }), new Promise((resolve) => setTimeout(resolve, 300))]);
        if (info?.location?.directory) {
          known.add(sid); if (known.size > 1000) known.delete(known.values().next().value);
          await hooks.event({ event: { type: 'session.updated', properties: { info: { id: sid, directory: info.location.directory } } } });
        }
      } catch { /* A missing session must not interrupt the agent. */ }
    };
    const registration = await ctx.session.hook('prompt', async (properties) => { await remember(properties.sessionID); await hooks.event({ event: { type: 'session.next.prompt.admitted', properties } }); });
    const listening = (async () => {
      for await (const input of ctx.event.subscribe({ signal: controller.signal })) {
        const data = input.data || {};
        let type = input.type, properties = data;
        if (type === 'session.created' || type === 'session.deleted') {
          properties = { info: { ...data, id: data.sessionID, directory: data.location?.directory } };
          if (type === 'session.created' && data.location?.directory) known.add(data.sessionID);
          if (type === 'session.deleted') known.delete(data.sessionID);
        } else await remember(data.sessionID);
        if (type === 'session.execution.started') { type = 'session.status'; properties = { ...data, status: { type: 'busy' } }; }
        else if (['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted'].includes(type)) { type = 'session.status'; properties = { ...data, status: { type: 'idle' } }; }
        else if (type === 'form.created') { type = 'question.asked'; properties = data.form || {}; }
        await hooks.event({ event: { type, properties } });
      }
    })().catch(() => {});
    return async () => { controller.abort(); await registration?.dispose?.(); await listening; };
  },
});
