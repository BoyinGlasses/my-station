// Normalize native hook payloads before they enter the office's session state.
const CODEX_TOOLS = { shell_command: 'Bash', exec_command: 'Bash', apply_patch: 'Edit' };
const OPENCODE_TOOLS = { bash: 'Bash', read: 'Read', edit: 'Edit', write: 'Write', grep: 'Grep', glob: 'Glob', webfetch: 'WebFetch', websearch: 'WebSearch', task: 'Task' };
const ANTIGRAVITY_TOOLS = { run_command: 'Bash', view_file: 'Read', view_file_outline: 'Read', grep_search: 'Grep', find_by_name: 'Glob', replace_file_content: 'Edit', multi_replace_file_content: 'Edit', write_to_file: 'Write', read_url_content: 'WebFetch', search_web: 'WebSearch' };

export function normalizeTool(agent, name = '', input = {}) {
  input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const names = agent === 'codex' ? CODEX_TOOLS : agent === 'opencode' ? OPENCODE_TOOLS : agent === 'antigravity' ? ANTIGRAVITY_TOOLS : {};
  const command = input.command || input.cmd || input.CommandLine;
  return { name: command ? 'Bash' : names[name] || name, input: { ...input, ...(command ? { command: Array.isArray(command) ? command.join(' ') : command } : {}), ...(input.filePath || input.AbsolutePath || input.TargetFile ? { file_path: input.filePath || input.AbsolutePath || input.TargetFile } : {}) } };
}

export function normalizeAgentEvent(p) {
  if (p?.agent === 'antigravity' && p.conversationId) {
    const args = p.toolCall?.args || {};
    p = { ...p, session_id: p.conversationId, cwd: p.workspacePaths?.[0], tool_name: ANTIGRAVITY_TOOLS[p.toolCall?.name] || p.toolCall?.name,
      tool_input: { ...args, command: args.CommandLine, file_path: args.AbsolutePath || args.TargetFile, query: args.SearchQuery, url: args.Url },
      prompt: p.lastUserInput, hook_event_name: p.hook_event_name === 'PreInvocation' ? 'UserPromptSubmit' : p.hook_event_name === 'PostToolUse' && p.error ? 'PostToolUseFailure' : p.hook_event_name };
  }
  if (!p || typeof p !== 'object' || typeof p.session_id !== 'string' || !p.session_id || typeof p.hook_event_name !== 'string' || !p.hook_event_name) return null;
  if (!p.agent || p.agent === 'claude') return p;
  if (!['codex', 'opencode', 'zcode', 'antigravity'].includes(p.agent)) return null;
  const { transcript_path: _transcript, ...event } = p;
  const toolName = (p.agent === 'codex' ? CODEX_TOOLS : p.agent === 'opencode' ? OPENCODE_TOOLS : { ApplyPatch: 'Edit' })[p.tool_name] || p.tool_name;
  const toolInput = p.agent === 'opencode' && p.tool_input?.filePath ? { ...p.tool_input, file_path: p.tool_input.filePath } : p.tool_input;
  return { ...event, ...(p.agent === 'codex' && typeof p.transcript_path === 'string' ? { codex_transcript_path: p.transcript_path } : {}), session_id: `${p.agent}:${p.session_id}`, hook_event_name: p.hook_event_name === 'Interrupt' ? 'Stop' : p.hook_event_name, tool_name: toolName, tool_input: toolInput };
}
