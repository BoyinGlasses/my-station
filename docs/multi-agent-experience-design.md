# Multi-agent experience: proposed design

Status: draft for review. No runtime behavior has been changed.

## Intent

My Office should present itself as an office for coding agents. Claude Code,
Codex, OpenCode, Antigravity and ZCode already have bridges in this working
tree. The product language and available actions should reflect that support.

This first phase makes those integrations understandable and consistent. A
team coordinator that delegates work between agents is a separate behavior
and remains a scope question for the user.

## Approaches

1. Replace generic references to Claude with “agent”. Small, but leaves
   incorrect actions, defaults and demo identities in place.
2. Make the existing five-agent experience consistent across identity,
   task routing, available actions, demo, documentation and both languages.
   Recommended: builds on the integrations already implemented.
3. Add an agent-to-agent task coordinator. Adds task ownership, handoff,
   concurrency and result aggregation; needs a separate design after the
   intended collaboration workflow is specified.

## First-phase behavior

- Product metadata, introductory copy, empty states, shared chat, phone-work
  settings and general notifications refer to coding agents or sessions.
- Session and task surfaces name the actual agent. Selected project and
  agent survive transitions between chat and the task sheet.
- Choosing OpenCode produces OpenCode copy and routes work to OpenCode;
  choosing Codex does the equivalent for Codex. An absent CLI is described
  as unavailable, rather than silently represented as Claude.
- Shared chat remains separate from messages sent to a real agent.
- Claude plan usage, account switching, cache estimates, loop hints and
  Remote Control keep explicit Claude labels. Their actions must not be
  presented as support for other agents.
- Missing cost, context or provider-limit data stays unavailable. It must
  not be inferred from Claude's values or displayed as a measured zero.
- The demo shows a mixture of supported agents with clearly fictional data.
  Its Claude-only examples remain attached to Claude sessions.
- Agent credentials and provider configuration stay owned by each CLI.

## Existing support to preserve

| Agent | Office-started work | Existing external conversation | Model selection | Permission cards |
| --- | --- | --- | --- | --- |
| Claude Code | New and continued conversations | Existing continuation behavior | Manual model ID | Tools, questions and plans |
| Codex | New and continued conversations | Fork, then resume office branch | Listed models or manual ID | Individual allow/deny when native hooks issue a request |
| OpenCode | New and continued conversations | Fork, then resume office branch | Listed models or manual ID | No office approval bridge; CLI may reject requests |
| Antigravity | New and continued office conversations | Not resumed by the office | Listed models or manual ID | No office approval bridge |
| ZCode | New and continued office conversations | Not resumed by the office | CLI configuration | No office approval bridge; retain confirmation-gated mode |

These are current integration limits, not promises of equivalent features.
CLI commands and protocols remain as currently implemented in this phase.

## Ownership and affected surfaces

Reuse the current event normalization, task runner, task API and agent logos.
Where identity or feature rules need to be shared between server and browser,
put the small fixed metadata in `src/shared/`; do not add a plugin framework.
CLI discovery and execution remain on the server. Feature descriptions never
replace authorization or input validation in API handlers.

Affected surfaces:

- English and Vietnamese dictionaries: common product copy, chat, task
  feedback, phone settings, notifications and empty states.
- Session drawer: identity and Claude-specific Remote Control guidance.
- Chat and task sheet: selected agent, model controls, contextual help and
  success messages.
- Demo fixtures and their machine-panel examples.
- Metadata, share-image alternative text, package description, introductory
  README sections and the existing multi-agent documentation.
- Unit/integration tests, multi-agent browser tests, affected demo assertions
  and the generated architecture module map.

Keep existing session IDs, saved chat formats, CLI hook definitions and
provider environments compatible. Internal legacy names do not need a rename
when they are not visible to users and do not affect routing.

## Acceptance checks

1. Codex-only and OpenCode-only setups do not instruct the user to install,
   message or open Claude for shared functionality.
2. A selected agent and model reach the correct task API request from both
   chat and the task sheet. Opening one from an existing choice preserves it.
3. Claude Remote Control, account switching and cache guidance are absent
   from non-Claude sessions; Claude sessions retain their current behavior.
4. Both languages show consistent agent identity and truthful limitations.
5. The demo visibly includes all five supported agent types and does not
   present Claude measurements as data from another agent.
6. Existing unit/integration tests, lint, typecheck and module-map check pass;
   focused browser tests verify routing, guidance and mixed-agent demo.

## Out of scope for this phase

Automatic inter-agent delegation, roles, shared agent memory, cross-provider
quota estimates, new CLI integrations, and unrelated issues from the earlier
audit. Product renaming and replacing existing share-card artwork also need
a separate branding decision.
