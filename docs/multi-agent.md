# Using other coding agents

The office can receive live events from Claude Code, Codex, Antigravity, ZCode, and OpenCode. Install the bridge for each agent you use, after installing this project and its dependencies:

```sh
node bin/cli.mjs install --agent codex
node bin/cli.mjs install --agent antigravity
node bin/cli.mjs install --agent zcode
node bin/cli.mjs install --agent opencode
```

Restart the agent after installation. Codex may ask you to trust the new hooks. The OpenCode installer detects the selected CLI version and installs its matching bridge; `OFFICE_OPENCODE_V1=1` explicitly selects the version 1 bridge. Set `OFFICE_PORT` when installing if the office listens on a port other than 4310. Remove a bridge with `node bin/cli.mjs uninstall --agent <name>`. The installers preserve other hooks and refuse to overwrite a conflicting named plugin. The ZCode installer refuses to enable existing disabled hooks: review those hooks before enabling them yourself.

On Windows, Codex hooks use `node` from `PATH` so they work in both PowerShell and cmd. After updating this project, run `node bin/cli.mjs install --agent codex` again to repair existing hook commands, restart Codex, and review the changed My Office hooks in `/hooks`. Codex skips changed hooks until you trust their new definitions. Use `node bin/cli.mjs doctor --agent codex` (or `opencode` / `antigravity`) to check that agent's bridge, CLI detection and observed activity. CLI detection does not prove model access.

Each agent continues to use its own configured model and provider. The office does not copy provider credentials or require a Claude subscription for these bridges. Hooks send session activity to the local office; their contents can include prompts and tool arguments, just as with Claude hooks. The existing redaction and translation settings apply.

When sending work in chat or the task sheet, select a model from the list, enter a model ID, or leave it empty to use the CLI default. The office asks OpenCode, Codex and Antigravity for their model lists in the chosen project; if the list is unavailable you can still enter an ID. Claude accepts a manually entered model ID. OpenCode uses `provider/model` (and may include `#variant`); the provider must already be configured in OpenCode. ZCode uses its own configured model. The office does not verify whether the agent or provider has access to the selected model.

The live session, status, activity and available tool events are shared with the office. Support depends on the events each agent provides: for example, ZCode does not provide a session-end hook, so a quiet session expires after ten minutes. An agent can omit a prompt, result, or event, and the office must not infer it.

The session drawer retains up to 120 observed user-facing messages and tool steps per non-Claude session in `data/agent-history/`, including across Office restarts. Private reasoning is excluded. Completed conversation bindings are saved for six hours, so subsequent messages resume the Office conversation after a restart. Codex can also read earlier user/assistant messages from a transcript under `$CODEX_HOME/sessions`, after verifying its session ID. Events from external sessions missed while Office was offline are not reconstructed.

Office-owned Codex work uses `app-server`; OpenCode and Antigravity use ACP over stdin/stdout. These protocols carry live results, images, cancellation and one-time approvals without disabling permission checks. OpenCode model selection uses advertised ACP config options; older ACP servers exposing the legacy model API remain supported. Model variants (`provider/model#variant`) are passed through the effort option when advertised.

You can send work to a resting Codex or OpenCode conversation: the first message forks it if the protocol supports forking, and subsequent messages resume that fork. Antigravity resumes the selected conversation itself; it does not advertise fork support. Office never silently replaces a requested fork with a resume of the original. ZCode keeps its existing confirmation-gated `build` runner; its interactive approvals are not implemented.

| Office-owned work | Codex | OpenCode | Antigravity |
| --- | --- | --- | --- |
| New project task, model selection, result/error | Yes | Yes | Yes |
| Images, stop/cancel | Yes | Yes, if advertised | Yes, if advertised |
| Resume a resting conversation | Yes | Yes | Yes |
| Fork without modifying the source conversation | Yes | If advertised | Not advertised |
| Command/file approvals in Office | One-time allow/deny | One-time allow/deny | One-time allow/deny |
| Structured questions | Non-secret native questions | Text conversation | Text conversation |
| Persist observed history and completed bindings | Yes | Yes | Yes |

Unsupported client methods are rejected, never auto-approved. Codex requests to grant persistent or broader permission profiles are denied; secret-input questions must be handled in the native CLI. External sessions started outside Office still use their native permission UI unless a separately installed synchronous approval hook supports Office. Activity bridges alone do not grant Office control of every external session.

The CLI must be available on `PATH`, or `OFFICE_CODEX_BIN` / `OFFICE_OPENCODE_BIN` / `OFFICE_ANTIGRAVITY_BIN` / `OFFICE_ZCODE_BIN` can select an executable or Node entry point. OpenCode follows the selected Windows/npm shim rather than picking another installed package. The existing phone-work permission applies; risky shell approvals remain restricted on phones. External activity bridges are optional and fail-open when Office is unavailable; approvals in Office-owned protocol runs default to deny on timeout or disconnect.

## Direct providers and subscriptions

9Router is optional. Office never installs a router, rewrites a provider URL, copies credentials or switches a CLI's global model. Claude Code can use its subscription/login; OpenCode can use its official `opencode/...` provider or any provider configured in that CLI. Select an `opencode/...` model in Office to use that provider directly. Leaving the model empty uses the CLI's current default, including an old router default if it is still configured there. Model lists describe CLI configuration, not guaranteed entitlement to every listed model.

Claude-specific background sessions, cache estimates, settings and plan accounting remain separate. Native account/quota integrations depend on each provider's available API; unsupported costs or limits are never guessed.
