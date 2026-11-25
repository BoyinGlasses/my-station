# `my-station` → Native Rust Application (`my-station-rs`) Design Spec

**Date:** 2026-11-25
**Status:** Approved (locked via `/grill-me`)
**Target Repository:** `d:\mystation\my-station-rs` (sibling repo; `d:\mystation\my-station` remains read-only Golden Oracle)

---

## 1. Objective

Rebuild 100% of `my-station` (zero feature cuts, visual and behavioral parity) into a native Windows-first Rust desktop application (`my-station-rs.exe`), cutting 3D runtime RAM from **2.21–2.42 GB** down to **≤ 300–380 MB** (and **≤ 45 MB** in System Tray background mode), eliminating periodic Windows `powershell.exe` (+70–123 MB) spikes, and adding a native **GUI Harness Launcher** dock.

---

## 2. Locked Architectural Decisions

1. **Repository & Oracle:** Create sibling repo `d:\mystation\my-station-rs`. Never modify runtime code in `d:\mystation\my-station`; run it as the live API & visual Golden Oracle across all milestones.
2. **3D Engine:** **Bevy** (`0.16` on `wgpu` DX12/Vulkan). Code-first procedural `Mesh` + `StandardMaterial` (metallic, roughness, emissive, clearcoat, transmission/glass, vertex colors) + PCF shadows + HDR `Bloom` + IBL + `MeshPicking` + shared `Handle<Mesh>` / `Handle<StandardMaterial>` caches.
3. **UI Stack:** **`bevy_egui`** with a custom design-token theme replicating all 29 CSS stylesheets in `src/styles/` and exact bundled fonts (`BeVietnamPro`, `JetBrainsMono`, `PlexThaiLooped` in TTF/OTF format for full Vietnamese & Thai glyph shaping).
4. **2D Procedural Textures:** **`tiny-skia` + `cosmic-text` + `resvg`** (`station-canvas2d`) replacing all 25 HTML5 `CanvasTexture` generators and loading `public/assets/brands/*.{svg,png}`. Drop CPU RGBA buffers immediately after GPU texture upload.
5. **Procedural Audio:** **`cpal` / `kira`** replacing all 5 Web `AudioContext` synth modules.
6. **Native GUI Harness Launcher:** Opens **GUI desktop apps directly (NO terminal spawn)**. Auto-detects 5 built-in harnesses (`Claude`, `Codex`, `OpenCode`, `ZCode`, `Antigravity`) via `.exe`, `.lnk`, or MSIX `PackageFamilyName`/AUMID, plus user-editable custom desktop apps (`data/harnesses.json`, e.g. `Orca`, `VS Code`, `OpenCode Infinite`). Clicking a button: (a) ensures hooks are wired if hookable, (b) restores & focuses the existing window if running (`SetForegroundWindow`), or (c) launches the GUI app detached (`ShellExecuteW` / `shell:AppsFolder\<AUMID>`).
7. **100% Drop-in Compatibility:**
   - Default listen address: `127.0.0.1:4310` (`OFFICE_HOST`, `OFFICE_PORT`).
   - Exact compatibility with `data/` JSON/JSONL schema (`OFFICE_DATA_DIR`), `hooks/send.mjs`, `/event`, `/hook/*`, `/v1/metrics`, `/v1/logs`, `/stream` SSE, `/api/*`, `/phone` PWA + Web Push + PIN/token auth + Cloudflare tunnel.
   - Adds fast native `my-station-rs hook` subcommand matching `hooks/send.mjs` CLI semantics without spawning `node.exe` per tool call.
8. **OS Platform Scope:** **Windows-first 100% native** (Win32 `sysinfo` + IP Helper `GetExtendedTcpTable` + `GetLastInputInfo` idle time + `tray-icon` System Tray + Windows Toast approval banners + Startup/Task Scheduler login service + Win32 window focus/launch). Isolate OS calls behind a clean `Platform` trait so macOS/Linux can be added later without refactoring callers.
9. **RAM & Window Lifecycle:**
   - Closing window (`X`) minimizes to **System Tray and fully unloads the 3D world & GPU assets** (`≤ 45 MB` daemon RAM); reopening rebuilds 3D on demand.
   - Switching `3D ↔ 2D Lite` performs true unload/reload (`≤ 110 MB` in 2D).
   - Switching backdrops (`city` / `countryside` / `beach`) despawns and drops inactive backdrop assets (`≤ 15 MB` drift across 3 full cycles).
   - Auto-throttles FPS: 60 fps focused → 10 fps unfocused → 0 fps minimized/tray.
   - Exposes GPU adapter selector in Settings (`Auto` / `Integrated` / `Discrete` — AMD Radeon iGPU vs NVIDIA RTX 2050).

---

## 3. Host Constraints & Non-Negotiable Build Guardrails

Verified host hardware: AMD Ryzen 5 7535HS (6C/12T), NVIDIA RTX 2050 (4 GB VRAM) + AMD Radeon iGPU, **8 GB RAM**, `C:` 9.6 GB free, `D:` 22.1 GB free, `rustc 1.97.1`, `cargo 1.97.1` (`x86_64-pc-windows-msvc`), `cmake`.

- `CARGO_TARGET_DIR` MUST be pinned to `D:\mystation\cargo-target` (never build on `C:`).
- `.cargo/config.toml` MUST set `[build] jobs = 2` (prevents OOM on 8 GB RAM).
- **Single Compiler Lock:** Only ONE `cargo` build/check/test process may run at a time across all agents/subagents.
- Workspace `Cargo.toml` MUST configure `[profile.dev] debug = 0`, `split-debuginfo = "packed"`, `[profile.dev.package."*"] opt-level = 1`, `[profile.release] lto = "thin"`, `codegen-units = 4`, `strip = "symbols"`.

### Hard Runtime RAM Budgets (Gate P6 Acceptance)
- Tray Background (window closed, 0 PowerShell spawns): **≤ 45 MB Private**
- 2D Lite / `/panel` window: **≤ 110 MB Private**
- 3D Pro (12 desks + city backdrop): **≤ 300 MB Private**
- 3D HQ (44 desks + city backdrop): **≤ 380 MB Private**
- 3D → 2D transition: **≥ 150 MB freed**; 3× backdrop cycle drift: **≤ 15 MB**

---

## 4. Source-Verified Protocol Constants (Copied Verbatim from `my-station`)

- **Network & Data:** `OFFICE_PORT` default `4310`, `OFFICE_HOST` default `127.0.0.1`, `OFFICE_DATA_DIR` override (default `<root>/data`, or `~/.my-office` if inside `node_modules`).
- **Auth:** `data/token` = 9 random bytes base64url (12 chars). `data/pin` = 6–10 digits (`^\d{6,10}$`), initial 6 digits zero-padded; weak PIN check rejects any PIN where consecutive digit deltas are all identical in `{0, 1, -1}`.
- **Prefs (`data/prefs.json`):** Atomic write via `${file}.${pid}.tmp` + rename. `AUTO_CLOSE_HOURS = [2, 4, 8]` (`0` = off).
- **Pins (`data/pins.json`):** `PIN_MAX = 12`, `PIN_LEN = 500`. `FEED_MAX = 80`, `DESKS = 9`.
- **Redaction (`server/redact.mjs`):** 9 ordered regexes replacing matched secrets with `"•••"` (`\u2022\u2022\u2022`), applied **before** any external translation or UI display:
  1. `(\bbearer\s+)[^\s"']+` → `$1•••` (case-insensitive)
  2. `\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}` → `•••`
  3. `\bgh[pousr]_[A-Za-z0-9]{10,}` → `•••`
  4. `\bxox[abpr]-[A-Za-z0-9-]{10,}` → `•••`
  5. `\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}` → `•••`
  6. `(\b(?:api[_-]?key|access[_-]?key|token|secret|password|passwd|pwd|authorization|cookie)\b["']?\s*[:=]\s*["']?)[^\s"'&]+` → `$1•••` (case-insensitive)
  7. `(\/\/)[^\s/:@]+:[^\s/@]+@` → `$1•••@`
  8. `\b(?:\d{1,3}\.){3}\d{1,3}\b` → `•••`
  9. `[A-Za-z0-9+_-]{32,}={0,2}` → `•••`
- **Multi-Agent Normalization (`server/agent-events.mjs`):**
  - Agents: `claude`, `codex`, `opencode`, `zcode`, `antigravity`.
  - Non-Claude `session_id` prefixed as `<agent>:<session_id>`; `Interrupt` → `Stop`.
  - Antigravity `conversationId` → `session_id`, `workspacePaths[0]` → `cwd`, `PreInvocation` → `UserPromptSubmit`, `PostToolUse` + truthy `error` → `PostToolUseFailure`.
  - Tool maps: Codex (`shell_command`/`exec_command` → `Bash`, `apply_patch` → `Edit`), OpenCode (`bash`/`read`/`edit`/`write`/`grep`/`glob`/`webfetch`/`websearch`/`task` → PascalCase), Antigravity (`run_command` → `Bash`, `view_file`/`view_file_outline` → `Read`, `grep_search` → `Grep`, `find_by_name` → `Glob`, `replace_file_content`/`multi_replace_file_content` → `Edit`, `write_to_file` → `Write`, `read_url_content` → `WebFetch`, `search_web` → `WebSearch`).
- **Hook Client (`hooks/send.mjs`):** `--async` (2000 ms timeout, no stdout), `--fast` (300 ms timeout), `--wait N` (default 55 s, sets `X-Office-Wait: N`), `--job` (`X-Office-Job` from `CLAUDE_JOB_DIR` basename, `X-Office-Inbox` from `CLAUDE_CODE_MESSAGING_SOCKET`), `--agent=<name>`, `--event=<name>`, `--response-json` (prints `{"decision":""}` on `Stop`, `{}` on non-`PreToolUse`). Never exits non-zero when server is unreachable.
- **CLI Hook Installer (`bin/cli.mjs`):** 13 Claude events (`SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Notification`, `SubagentStart`, `SubagentStop`, `Stop`, `StopFailure`, `PreCompact`), `ASK_MATCHER = "AskUserQuestion|ExitPlanMode"`, `WAIT_S = 600`, `DENY_CMD` wait `50`, `LOOP_CMD` 0.3 s, `START_CMD` 3 s; always writes timestamped `.backup-*` copy + atomic temp-rename.
- **Hold Policy (`server/mac-hold.mjs`):** `BAR_ALIVE_MS = 8000`, `BAR_IDLE_MAX_SEC = 120`, `BAR_HOLD_MS = 20000` (clamped by `OFFICE_BAR_HOLD_MS`), `PHONE_HOLD_MS = 600000`, `BACK_SEC = 20`.
- **OTLP Receiver (`server/otel.mjs`):** Metric names `claude_code.cost.usage`, `claude_code.token.usage`; events `api_request`, `api_error`, `user_prompt`; caps `MAX_DAY_SESSIONS = 500`, `MAX_SUMS = 150`, `MAX_SESSIONS = 3000`, `MAX_SERIES = 20000`, `MAX_SEEN = 5000`; 30-day retention in `data/otel/`.
- **Trophies (`server/trophies.mjs`):** 22 milestones (`open`, `p100..p10k`, `e1k..e100k`, `c1k..c100k`, `r1k..r100k`, `d1..d100`, `s10..s1k`, `days7..days100`) stored in `data/totals.json` with FNV-1a 32-bit dedupe.
- **Security Boundaries:** Loopback-only enforcement for `/event`, `/hook/*`, `/v1/*`, and local-only `/api/*` admin routes; strict `Host` header (`localhost`/`127.0.0.1`/`[::1]`) and `Origin` rejection on `/event` and `/api/harnesses/*`.

---

## 5. Cargo Workspace & Subsystem Plan Decomposition

Per `writing-plans` Scope Check, this program is decomposed into **7 independently testable subsystem plans**, executed sequentially (`P0` → `P6`). Each plan produces runnable, verified software before the next plan is authored or started:

| Plan | Crate(s) | Deliverable & Gate | Status |
|---|---|---|---|
| **P0** | Workspace + `station-app` | `docs/superpowers/plans/2026-11-25-rust-native-p0-bootstrap.md` — Repo, 8 GB `.cargo/config.toml`, fonts/assets/i18n sync, Bevy + `bevy_egui` `--capture-scene smoke` PNG verification | **Written** |
| **P1** | `station-core` + `station-launcher` + `station-app` CLI | `docs/superpowers/plans/2026-11-25-rust-native-p1-core-and-launcher.md` — 44 `server/` + 11 `shared/` + 2 `bin/` + 4 `hooks/` + 65 routes + zero-PowerShell Win32 + GUI Harness Launcher + Contract Oracle pass | **Written** |
| **P2** | `station-canvas2d` | `2026-11-25-rust-native-p2-canvas2d.md` *(author after P1 passes)* — All 25 procedural 2D texture generators + brand SVG/PNG loaders + Golden PNG Oracle | Pending P1 |
| **P3** | `station-3d` (Part 1) | `2026-11-25-rust-native-p3-world-core.md` *(author after P2 passes)* — Layouts (`cozy`/`pro`/`hq`), furniture, 22 props (`tv-games`), lighting/bloom, camera, raycast + Visual Oracle | Pending P2 |
| **P4** | `station-3d` (Part 2) | `2026-11-25-rust-native-p4-people-backdrops-life.md` *(author after P3 passes)* — Chibi rig (shared indexed meshes), 32 `people/`, 36 `backdrops/` (true unload), 15 `life/`, `demo/`, `replay/`, `audio/` | Pending P3 |
| **P5** | `station-ui` + `station-app` | `2026-11-25-rust-native-p5-ui-panel-tray.md` *(author after P4 passes)* — 42 `ui/`, 7 `panel/`, 20 `components/`, 55 `styles/`, 105 `i18n/`, 2D Lite unload, Harness Launcher Dock, System Tray & Toast Approve | Pending P4 |
| **P6** | Full App | `2026-11-25-rust-native-p6-e2e-ram-certification.md` *(author after P5 passes)* — Full E2E hooks + launcher + side-by-side visual diff + Windows Private RAM & leak soak certification + release build | Pending P5 |

---

## 6. Complete 100% Parity Ledger (449 Source Files + 65+ Endpoints)

No subsystem plan may close until every source file assigned to it is checked off in `d:\mystation\my-station-rs\PARITY_LEDGER.md` with mapped Rust file path and test/screenshot proof:

- **P1 — Backend, Shared, CLI & Hooks (61 files + 65 endpoints):**
  - `server/` (44): `agent-events`, `agent-history`, `agent-rpc`, `antigravity-accounts`, `antigravity-runs`, `auto-resume`, `bg-sessions`, `claude-version`, `cli-command`, `codex-accounts`, `codex-history`, `data-dir`, `git`, `index`, `lift-service`, `loops`, `mac-hold`, `models`, `otel-setup`, `otel`, `overlap`, `prefs`, `prompt-report`, `push`, `redact`, `rewrite`, `shots`, `steer`, `stranded`, `system`, `tasks`, `tenure`, `testrun`, `trophies`, `undo`, `usage`, `vault`, `vsix`, `wrapped`, `platform/{index,shared,win32,darwin,linux}`
  - `src/shared/` (11): `burn`, `cache-clock`, `chat-engine`, `comnha`, `danger`, `duty`, `model-name`, `prompt-coach`, `quick-choices`, `timeline`, `workdays`
  - `bin/` (2) & `hooks/` (4): `bin/{cli,service}.mjs`, `hooks/{hooks.json,opencode.mjs,send.mjs,status-line.mjs}`
  - HTTP/SSE/OTLP Endpoints (65+): `POST /event`, `POST /v1/{metrics,logs}`, `POST /hook/{question,bind,status,loop,start,denied,permission}`, `GET /health`, `GET /stream`, `GET /api/{live,doctor,log,timeline,wrapped,replay,replay/days,stranded,pins,vault,vault/report,undo,burn,sys,panel,chat,loop,tenure,cache,tasks,models,quick,claude-version,push,image,macapprove,tunnel}`, `GET|POST /pin`, `POST /api/{presence,perm,pin,lan,phone,push,tunnel,tunnel/domain,rc,tasks,tasks/allow,tasks/bg,tasks/stop,tasks/steer,prompt/rewrite,chat,sys/auto,sys/action,panel/answer,panel/open,open,stranded/open,stranded/remove,tenure,denied,pins,undo,ci,loop,models,cache,prefs,todos,macapprove}`, `POST /api/accounts[/(code|cancel|login|rename|use|auto|order|move|renew)]`, `POST /api/ai/(codex|ag)/(use|add|cancel|remove|rename|auto|order|later|read)`, plus new loopback-only `/api/harnesses`, `/api/harnesses/launch`, `/api/harnesses/custom`.
- **P2 — 2D Procedural Texture Generators (25 `CanvasTexture` surfaces + 17 `public/` assets):** screens, shop facades, street signs, whiteboard, TV/arcade games, floor/rug/duty-board/notice-board, portraits, chat avatars, photostrips, brand SVGs/PNGs.
- **P3 — 3D World Core, Layouts, Furniture & Props (54 files):** `main`, `core/{env,loop,optimize,state,world-boot}`, `scene/{blocks,lights,quality,renderer}`, `interact/{first-person,place-cards,place-chips,props,rings}`, `net/live`, `world/{layout,cozy-room,desks,entrance,windows,terrace,screens,room-update}`, `world/pro/{floor,pieces,wing}`, `world/furniture/{board,coffee,meeting,plants-lamps,rocket,room-pieces,server-racks}`, `world/props/{aquarium,arcade,billiards,bins,cat,cups,dev-servers,duty-board,game-tv,karaoke,microwave,neon,printer,shredder,string-lights,switches,trinkets,tv-games,tv,update,vacuum}` (21 files + prop registry).
- **P4 — People, Backdrops, Life, Demo, Replay & Audio (88 files):** `people/` (32), `world/backdrops/` (36), `life/` (15), `demo/` (2), `replay/` (2), `audio/sfx` (1).
- **P5 — UI, Panel, Components, Styles & i18n (229 files):** `src/office/ui/` (42), `src/panel/` (7), `src/components/` (20) + `app/{page,panel/page}`, `src/styles/` (55: 29 CSS + 26 fonts), `src/i18n/` (105).
