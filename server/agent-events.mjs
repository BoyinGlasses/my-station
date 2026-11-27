// Normalize native hook payloads before they enter the office's session state.
const CODEX_TOOLS = { shell_command: 'Bash', exec_command: 'Bash', apply_patch: 'Edit' };
const OPENCODE_TOOLS = { bash: 'Bash', read: 'Read', edit: 'Edit', write: 'Write', grep: 'Grep', glob: 'Glob', webfetch: 'WebFetch', websearch: 'WebSearch', task: 'Task' };
const ANTIGRAVITY_TOOLS = { run_command: 'Bash', view_file: 'Read', view_file_outline: 'Read', grep_search: 'Grep', find_by_name: 'Glob', replace_file_content: 'Edit', multi_replace_file_content: 'Edit', write_to_file: 'Write', read_url_content: 'WebFetch', search_web: 'WebSearch' };
const ZCODE_TOOLS = { ApplyPatch: 'Edit' };
const SHELL_TOOLS = new Set(['', 'Bash', 'PowerShell', 'bash', 'shell', 'shell_command', 'exec_command', 'run_command', 'terminal']);

export function normalizeTool(agent, name = '', input = {}) {
  input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const names = agent === 'codex' ? CODEX_TOOLS : agent === 'opencode' ? OPENCODE_TOOLS : agent === 'antigravity' ? ANTIGRAVITY_TOOLS : agent === 'zcode' ? ZCODE_TOOLS : {};
  const mapped = names[name] || name;
  const command = input.command || input.cmd || input.CommandLine;
  const filePath = input.file_path || input.filePath || input.AbsolutePath || input.TargetFile;
  const pattern = input.pattern || input.Pattern || input.Query || input.SearchQuery;
  const query = input.query || input.SearchQuery || input.Query;
  const url = input.url || input.Url;
  const outName = command && SHELL_TOOLS.has(name) ? 'Bash' : mapped;
  return {
    name: outName,
    input: {
      ...input,
      ...(command && (outName === 'Bash' || outName === 'PowerShell') ? { command: Array.isArray(command) ? command.join(' ') : command } : {}),
      ...(filePath ? { file_path: filePath } : {}),
      ...(pattern && (outName === 'Grep' || outName === 'Glob') ? { pattern } : {}),
      ...(query && outName === 'WebSearch' ? { query } : {}),
      ...(url && outName === 'WebFetch' ? { url } : {}),
    },
  };
}

export function normalizeAgentEvent(p) {
  if (p?.agent === 'antigravity' && p.conversationId) {
    const args = p.toolCall?.args || {};
    p = { ...p, session_id: p.conversationId, cwd: p.workspacePaths?.[0], tool_name: p.toolCall?.name || '',
      tool_input: args,
      prompt: p.lastUserInput, hook_event_name: p.hook_event_name === 'PreInvocation' ? 'UserPromptSubmit' : p.hook_event_name === 'PostToolUse' && p.error ? 'PostToolUseFailure' : p.hook_event_name };
  }
  if (!p || typeof p !== 'object' || typeof p.session_id !== 'string' || !p.session_id || typeof p.hook_event_name !== 'string' || !p.hook_event_name) return null;
  if (!p.agent || p.agent === 'claude') return p;
  if (!['codex', 'opencode', 'zcode', 'antigravity'].includes(p.agent)) return null;
  const { transcript_path: _transcript, ...event } = p;
  const tool = p.tool_name || p.tool_input ? normalizeTool(p.agent, p.tool_name || '', p.tool_input) : null;
  return {
    ...event,
    ...(p.agent === 'codex' && typeof p.transcript_path === 'string' ? { codex_transcript_path: p.transcript_path } : {}),
    session_id: `${p.agent}:${p.session_id}`,
    hook_event_name: p.hook_event_name === 'Interrupt' ? 'Stop' : p.hook_event_name,
    ...(tool ? { tool_name: tool.name, tool_input: tool.input } : {}),
  };
}
