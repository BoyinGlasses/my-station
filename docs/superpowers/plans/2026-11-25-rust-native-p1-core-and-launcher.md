# Rust Native Rewrite — Plan 1: Full Backend Parity (`station-core`) & Native GUI Harness Launcher (`station-launcher`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port 100% of `my-station`'s backend (`44` `server/` files, `11` `src/shared/` files, `2` `bin/` files, `4` `hooks/` files, all `65+` HTTP/SSE/OTLP routes on port `4310`), replace Windows PowerShell polling with zero-spawn native Win32 metrics, ship the native `my-station-rs hook` subcommand, and implement the native Windows GUI Harness Launcher (`station-launcher`).

**Architecture:** `station-core` houses all state machines, persistence, telemetry, Win32 system readings, and the Axum HTTP/SSE/OTLP router behind a clean `Platform` trait. `station-launcher` discovers installed Windows GUI harness apps (`.exe`, `.lnk`, MSIX AUMID), runs idempotent hook installation preflight, and focuses or launches apps via Win32 APIs without spawning terminals. `station-app` wires `serve`, `hook`, `install`, `uninstall`, `service`, and `doctor` CLI subcommands, verified against an adapted contract runner executing the Golden Oracle's existing test scenarios.

**Tech Stack:** Rust (`tokio`, `axum`, `tower-http`, `serde`, `serde_json`, `regex`, `chrono`, `sysinfo`, `windows-sys`, `reqwest`, `web-push`, `base64`, `rand`, `notify`, `anyhow`), Node.js (Oracle contract runner only).

**Spec:** `d:\mystation\my-station\docs\superpowers\specs\2026-11-25-rust-native-rewrite-design.md`

## Global Constraints

- Prerequisite: Plan 0 (`2026-11-25-rust-native-p0-bootstrap.md`) completed and green in `d:\mystation\my-station-rs`.
- NEVER edit runtime files in `d:\mystation\my-station` (read-only Golden Oracle).
- Single Compiler Lock: NEVER run two `cargo` commands concurrently on this 8 GB RAM host (`jobs = 2`, `CARGO_TARGET_DIR = D:\mystation\cargo-target`).
- Default listen address: `127.0.0.1:4310` (`OFFICE_HOST`, `OFFICE_PORT`).
- `redact()` MUST run BEFORE any external translation/rewrite or UI emission using all 9 regexes from `server/redact.mjs` with replacement `"•••"`.
- Loopback-only enforcement + strict `Host` (`localhost`/`127.0.0.1`/`[::1]`) and `Origin` guard MUST protect `/event`, `/hook/*`, `/v1/*`, and `/api/harnesses/*`.
- Zero `powershell.exe` child processes may EVER be spawned by `station-core` or `station-launcher` on Windows.
- Standalone `my-station-rs serve` idle RAM MUST stay `≤ 35 MB Private` over a 70-second soak.
- Every task commits atomically in `d:\mystation\my-station-rs` and updates `PARITY_LEDGER.md`.

## Review Focus

1. **Non-loopback or spoofed-Origin/Host request to `/event` or `/api/harnesses/launch`** — a malicious web page attempting CSRF/DNS-rebinding against `127.0.0.1:4310` must receive `403` and trigger zero session mutations or process launches; pinned by tests in Tasks 6 & 9.
2. **Secret leakage before translation/rewrite or into OTLP disk logs** — prompts containing `Bearer ...`, `sk-...`, `ghp_...`, JWTs, URLs with `user:pass@`, or IPv4 addresses must be masked with `"•••"` before hitting `/api/prompt/rewrite` or `data/otel/`; pinned by tests in Tasks 1 & 5.
3. **Hook subcommand (`my-station-rs hook`) when `my-station-rs serve` is down or slow** — hook must exit `0` within `--fast` (300 ms) or `--async` (2000 ms) timeout without breaking Claude/Codex/Antigravity, and still print `{"decision":""}` on `--response-json --event=Stop`; pinned by tests in Task 7.
4. **Corrupted or missing `data/*.json` files and concurrent shutdown writes** — malformed `prefs.json`/`pins.json`/`totals.json`/`harnesses.json` must recover to safe defaults without panicking, and atomic temp-rename writes must flush cleanly on Ctrl+C / SIGTERM; pinned by tests in Tasks 1 & 8.
5. **Harness Launcher clicking an already-running MSIX/Win32 app or a missing/custom executable path** — already-running app must be restored & focused instead of spawning a duplicate instance, a missing executable must return a structured `NotInstalled` error (never panic), and no terminal/console window may spawn; pinned by tests in Tasks 8 & 9.

---

## File Structure

All paths below are relative to `d:\mystation\my-station-rs\`:

- `crates/station-core/src/config.rs` — `data_dir`, env parsing (`OFFICE_PORT`, `OFFICE_HOST`, `OFFICE_DATA_DIR`, `CLAUDE_CONFIG_DIR`).
- `crates/station-core/src/atomic.rs` — atomic temp-file write + rename helper (`write_json_atomic`) + timestamped backup helper.
- `crates/station-core/src/redact.rs` — 9-regex `redact(&str) -> String`.
- `crates/station-core/src/prefs.rs` — `PrefsStore` (`data/prefs.json`, `AUTO_CLOSE_HOURS = [2, 4, 8]`, language lookup).
- `crates/station-core/src/auth.rs` — `data/token` (9 bytes base64url), `data/pin` (6–10 digits, `pin_weak`), signed cookie verification.
- `crates/station-core/src/shared/` — 11 modules mirroring `src/shared/`: `burn.rs`, `cache_clock.rs`, `chat_engine.rs`, `comnha.rs`, `danger.rs`, `duty.rs`, `model_name.rs`, `prompt_coach.rs`, `quick_choices.rs`, `timeline.rs`, `workdays.rs`.
- `crates/station-core/src/platform/` — `mod.rs` (`Platform` trait), `win32.rs` (native `sysinfo`, `GetExtendedTcpTable`, `GetLastInputInfo`, `GlobalMemoryStatusEx`, `GetDiskFreeSpaceExW`), `stubs.rs` (`darwin`/`linux` trait stubs).
- `crates/station-core/src/system.rs` — port of `server/system.mjs` (`sys_snapshot`, `sys_action`, `scan_cleanups`, `track_owners`, trend sampler).
- `crates/station-core/src/agent_events.rs` — port of `server/agent-events.mjs` (`normalize_tool`, `normalize_agent_event`).
- `crates/station-core/src/state/` — `mod.rs`, `sessions.rs`, `mac_hold.rs`, `loops.rs`, `overlap.rs`, `undo.rs`, `auto_resume.rs`, `steer.rs`, `bg_sessions.rs`, `stranded.rs`, `tasks.rs`, `git.rs`, `testrun.rs`, `lift_service.rs`, `tenure.rs`, `models.rs`, `claude_version.rs`.
- `crates/station-core/src/store/` — `otel.rs`, `otel_setup.rs`, `usage.rs`, `vault.rs`, `prompt_report.rs`, `rewrite.rs`, `trophies.rs`, `wrapped.rs`, `shots.rs`, `push.rs`, `agent_history.rs`, `codex_history.rs`, `codex_accounts.rs`, `antigravity_accounts.rs`, `antigravity_runs.rs`, `agent_rpc.rs`, `vsix.rs`.
- `crates/station-core/src/http/` — `mod.rs`, `guard.rs` (Host/Origin/loopback/tunnel middleware), `hooks.rs`, `api.rs`, `sse.rs`, `phone.rs` (static `/phone` PWA + `/pin` auth), `otel_routes.rs`.
- `crates/station-core/src/hooks_cli.rs` — hook installer/uninstaller/doctor (`bin/cli.mjs` + `bin/service.mjs` + `hooks/opencode.mjs` + `hooks/status-line.mjs` parity).
- `crates/station-core/src/hook_client.rs` — native Rust `my-station-rs hook` implementation (`hooks/send.mjs` parity).
- `crates/station-launcher/src/catalog.rs` — built-in 5 harness specs + `data/harnesses.json` custom app store.
- `crates/station-launcher/src/detect_win32.rs` — `.exe`, `.lnk`, and MSIX `PackageFamilyName` / AUMID discovery.
- `crates/station-launcher/src/focus_launch.rs` — `EnumWindows` + `SetForegroundWindow` + `ShellExecuteW` / `shell:AppsFolder\<AUMID>` (zero console).
- `crates/station-launcher/src/lib.rs` — `HarnessLauncher` service combining detection, hook preflight, status dot computation, and focus-or-launch.
- `crates/station-app/src/commands.rs` — wires `serve`, `hook`, `install`, `uninstall`, `service`, `doctor`.
- `scripts/run-oracle-contract-tests.mjs` — executes existing HTTP/hook/security/OTLP contract checks from `d:\mystation\my-station` against `my-station-rs serve`.

---

### Task 1: Data Directory, Atomic Persistence, Auth (`token`/`pin`), `prefs`, & `redact`

**Files:**
- Create: `crates/station-core/src/{config.rs,atomic.rs,redact.rs,prefs.rs,auth.rs}`
- Modify: `crates/station-core/Cargo.toml`, `crates/station-core/src/lib.rs`

**Interfaces:**
- Consumes: Spec Section 4 (`OFFICE_DATA_DIR`, `AUTO_CLOSE_HOURS`, `PIN_RE`, 9 regexes).
- Produces:
  - `pub fn resolve_data_dir(root: &Path, env_override: Option<&str>) -> PathBuf`
  - `pub fn write_json_atomic<T: serde::Serialize>(path: &Path, value: &T) -> anyhow::Result<()>`
  - `pub fn redact(input: &str) -> String`
  - `pub struct PrefsStore` (`load(data_dir)`, `lang() -> &str`, `set_lang(&mut self, l: &str) -> bool`, `auto_close() -> u8`, `set_auto_close(&mut self, h: u8) -> bool`, `get(&self, k: &str) -> Option<&serde_json::Value>`, `set(&mut self, k: &str, v: Option<serde_json::Value>) -> Result<()>`)
  - `pub fn pin_weak(pin: &str) -> bool`
  - `pub struct AuthStore` (`load_or_init(data_dir)`, `token() -> &str`, `current_pin() -> String`, `set_pin(&self, pin: &str) -> Result<bool>`, `sign_cookie(&self, remember: bool) -> String`, `verify_cookie(&self, cookie: &str) -> bool`)

- [ ] **Step 1: Write failing unit tests covering all 9 `redact` patterns, weak PINs, atomic writes, and corrupted `prefs.json` recovery (Review Focus #2 & #4)**

In `crates/station-core/src/{redact.rs,auth.rs,prefs.rs}`:
- Assert `redact("Bearer abc123 sk-12345678 ghp_1234567890 xoxb-1234567890 eyJhbGciOiJI.eyJzdWIiOiIx.abcd https://u:p@host 192.168.1.5 password=secret ABCDEFGHIJKLMNOPQRSTUVWXYZ012345")` replaces every secret with `"•••"` and preserves `"Bearer •••"`.
- Assert `pin_weak("111111")`, `pin_weak("123456")`, `pin_weak("987654")`, `pin_weak("12345")` are `true`; `pin_weak("492817")` is `false`.
- Assert `PrefsStore::load` on a directory containing invalid JSON `{broken` recovers to defaults without panicking, rejects `set_auto_close(3)`, accepts `set_auto_close(4)`, and persists atomically across reload.

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test -p station-core`
Expected: FAIL (modules do not exist).

- [ ] **Step 3: Implement `config.rs`, `atomic.rs`, `redact.rs`, `prefs.rs`, and `auth.rs`**

Use `std::sync::OnceLock<Vec<(Regex, &'static str)>>` for `redact()`. Write atomic files as `<file>.<pid>.tmp` followed by Windows-safe replace (`std::fs::rename` with fallback overwrite if target exists on Windows).

- [ ] **Step 4: Run tests to verify pass**

Run: `cargo test -p station-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/station-core/ PARITY_LEDGER.md
git commit -m "feat(core): port config, atomic store, prefs, auth pin/token, and redact"
```

---

### Task 2: All 11 `src/shared/` Pure Domain Modules

**Files:**
- Create: `crates/station-core/src/shared/{mod.rs,burn.rs,cache_clock.rs,chat_engine.rs,comnha.rs,danger.rs,duty.rs,model_name.rs,prompt_coach.rs,quick_choices.rs,timeline.rs,workdays.rs}`
- Modify: `crates/station-core/src/lib.rs`

**Interfaces:**
- Consumes: Reference implementations in `d:\mystation\my-station\src\shared\*.js` and unit tests in `d:\mystation\my-station\tests\unit\{burn-roles,cache-clock,comnha,duty,prompt-coach,quick-choices,timeline,workdays}.test.mjs`.
- Produces:
  - `station_core::shared::burn::{DIMS, SumTuple, add_to, summarize, project_of}`
  - `station_core::shared::cache_clock::{cache_clock, cache_from_resume, cache_from_status, cache_guess}`
  - `station_core::shared::chat_engine::{ChatEngine, REACTIONS}`
  - `station_core::shared::danger::danger_key`
  - `station_core::shared::duty`, `comnha`, `model_name`, `prompt_coach`, `quick_choices`, `timeline`, `workdays` public APIs matching exact JS outputs.

- [ ] **Step 1: Port exact test assertions from the 8 Oracle unit test files (`tests/unit/{burn-roles,cache-clock,comnha,duty,prompt-coach,quick-choices,timeline,workdays}.test.mjs`) + tests for `chat_engine`, `danger`, `model_name`**

Read each JS file in `d:\mystation\my-station\src\shared\` and its corresponding test in `tests/unit/`, then write failing Rust unit tests asserting the exact outputs.

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test -p station-core shared::`
Expected: FAIL (modules unimplemented).

- [ ] **Step 3: Implement all 11 modules under `crates/station-core/src/shared/`**

Preserve exact field names, rounding rules, regexes, and `serde` JSON shapes so both native UI and `/api/*` consumers see identical payloads.

- [ ] **Step 4: Run tests to verify pass**

Run: `cargo test -p station-core shared::`
Expected: PASS across all 11 shared modules.

- [ ] **Step 5: Commit**

```bash
git add crates/station-core/src/shared/ crates/station-core/src/lib.rs PARITY_LEDGER.md
git commit -m "feat(core): port all 11 shared domain modules with Oracle unit parity"
```

---

### Task 3: Zero-PowerShell Win32 `Platform` Trait & `system` Monitor

**Files:**
- Create: `crates/station-core/src/platform/{mod.rs,win32.rs,stubs.rs}`
- Create: `crates/station-core/src/system.rs`
- Modify: `crates/station-core/Cargo.toml`, `crates/station-core/src/lib.rs`

**Interfaces:**
- Consumes: `station_core::redact::redact`, reference `server/platform/win32.mjs` and `server/system.mjs`.
- Produces:
  - `#[derive(Debug, Clone)] pub struct ProcRow { pub pid: u32, pub ppid: u32, pub pgid: u32, pub uid: u32, pub rss: u64, pub mem: u64, pub start: u64, pub up: u64, pub cpu_sec: f64, pub cpu_pct: f32, pub comm: String, pub args: String }`
  - `#[derive(Debug, Clone)] pub struct MemStats { pub total: u64, pub used: u64, pub compressed: u64, pub swap_total: u64, pub swap_used: u64, pub pressure: &'static str }`
  - `pub trait Platform: Send + Sync`: `name()`, `processes()`, `lite_procs()`, `memory()`, `disk()`, `listeners()`, `established()`, `idle_seconds() -> Option<f64>`, `folder_bytes(&Path)`, `claude_login(&Path)`.
  - `pub struct Win32Platform;` (uses `sysinfo::System`, `windows-sys` `GetExtendedTcpTable` for TCP IPv4/IPv6 listeners/established, `GetLastInputInfo` for idle seconds, `GlobalMemoryStatusEx` for memory/pagefile, `GetDiskFreeSpaceExW` for disk — **NEVER spawns `powershell.exe`**).
  - `pub struct SystemMonitor` (`snapshot()`, `action()`, `scan_cleanups()`, `track_owners()` — bounded `port_seen` map capped at 1024 entries).

- [ ] **Step 1: Write failing unit tests for `Win32Platform` live reading, idle seconds, TCP listeners, and `SystemMonitor` snapshot**

Test:
- Bind a local `TcpListener::bind("127.0.0.1:0")` in the test, call `Win32Platform::new().listeners()`, and assert the bound port appears under `std::process::id()`.
- Call `memory()`, `disk()`, `processes()`, `idle_seconds()` and assert `total > 0`, current PID is in `procs`, and `idle_seconds()` returns `Some(s)` with `s >= 0.0`.
- Assert `SystemMonitor::snapshot()` succeeds and redacts secrets in command lines.

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test -p station-core platform::`
Expected: FAIL (modules not defined).

- [ ] **Step 3: Implement `platform/{mod,win32,stubs}.rs` and `system.rs`**

Use a 2-second TTL cache inside `Win32Platform` matching `win32.mjs`, and implement `Platform` stubs for `#[cfg(not(windows))]` so non-Windows compilation stays clean. Port all cleanup scanners and safe actions from `server/system.mjs`.

- [ ] **Step 4: Run tests to verify pass**

Run: `cargo test -p station-core platform::` and `cargo test -p station-core system::`
Expected: PASS in < 1 s with ZERO child process spawns.

- [ ] **Step 5: Commit**

```bash
git add crates/station-core/Cargo.toml crates/station-core/src/platform/ crates/station-core/src/system.rs crates/station-core/src/lib.rs PARITY_LEDGER.md
git commit -m "feat(core): implement zero-PowerShell Win32 Platform trait and system monitor"
```

---

### Task 4A: Multi-Agent Event Normalizer, Session Store, Hold Policy, Loops, Overlap & Undo

**Files:**
- Create: `crates/station-core/src/agent_events.rs`
- Create: `crates/station-core/src/state/{mod.rs,sessions.rs,mac_hold.rs,loops.rs,overlap.rs,undo.rs}`

**Interfaces:**
- Consumes: `station_core::{prefs,redact,atomic,shared,platform}`, Oracle files in `d:\mystation\my-station\server\{agent-events,mac-hold,loops,overlap,undo}.mjs`.
- Produces:
  - `pub fn normalize_tool(agent: &str, name: &str, input: serde_json::Value) -> (String, serde_json::Value)`
  - `pub fn normalize_agent_event(payload: serde_json::Value) -> Option<NormalizedEvent>`
  - `pub fn hold_plan(input: HoldInput) -> HoldDecision` (`BAR_ALIVE_MS = 8000`, `BAR_IDLE_MAX_SEC = 120`, `PHONE_HOLD_MS = 600_000`, `BACK_SEC = 20`)
  - `pub struct OfficeState` managing `sessions`, `feed` (capped at `FEED_MAX = 80`), `pending_perms`, `pins` (`PIN_MAX = 12`, `PIN_LEN = 500`), `undo`, `loops`, `overlap`, and broadcast channel for SSE `/stream` + `/api/live` sequence numbers.

- [ ] **Step 1: Write failing unit tests ported from Oracle `tests/unit/{agent-events,mac-hold,loops,loop-hook,overlap,undo}.test.mjs`**

Assert exact tool normalization (`codex`/`opencode`/`antigravity`), `session_id` prefixing, `Interrupt` → `Stop`, `hold_plan` priorities (away-phone > focused-page > bar > 0), loop blocking thresholds, overlap detection, and per-turn undo snapshots.

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test -p station-core agent_events::` and `cargo test -p station-core state::`
Expected: FAIL.

- [ ] **Step 3: Implement `agent_events.rs` and `state/{mod,sessions,mac_hold,loops,overlap,undo}.rs`**

- [ ] **Step 4: Run tests to verify pass**

Run: `cargo test -p station-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/station-core/src/agent_events.rs crates/station-core/src/state/ crates/station-core/src/lib.rs PARITY_LEDGER.md
git commit -m "feat(core): port agent normalizer, sessions, hold policy, loops, overlap, and undo"
```

---

### Task 4B: Workflow Engines (`tasks`, `bg_sessions`, `auto_resume`, `steer`, `stranded`, `git`, `testrun`, `lift_service`, `tenure`, `models`, `claude_version`)

**Files:**
- Create: `crates/station-core/src/state/{auto_resume.rs,steer.rs,bg_sessions.rs,stranded.rs,tasks.rs,git.rs,testrun.rs,lift_service.rs,tenure.rs,models.rs,claude_version.rs}`
- Modify: `crates/station-core/src/state/mod.rs`

**Interfaces:**
- Consumes: `OfficeState`, `station_core::{prefs,atomic,platform}`, Oracle files in `d:\mystation\my-station\server\*.mjs`.
- Produces:
  - Sub-engines attached to `OfficeState`: `tasks`, `bg_sessions`, `auto_resume`, `steer`, `stranded`, `git`, `testrun`, `lift_service`, `tenure`, `models`, `claude_version`, plus `OfficeState::flush_all() -> anyhow::Result<()>` (evicting finished task IDs from `task_sids`/`task_quote` so maps stay bounded).

- [ ] **Step 1: Write failing unit tests ported from Oracle `tests/unit/{auto-resume,steer,bg-sessions,stranded,tenure,testrun,lift-service,models,git-release,codex-tasks,opencode-tasks,zcode-tasks,antigravity-tasks,model-project-path}.test.mjs`**

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test -p station-core state::`
Expected: FAIL.

- [ ] **Step 3: Implement the 11 workflow engine modules in `crates/station-core/src/state/`**

- [ ] **Step 4: Run tests to verify pass**

Run: `cargo test -p station-core state::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/station-core/src/state/ PARITY_LEDGER.md
git commit -m "feat(core): port tasks, bg-sessions, auto-resume, steer, stranded, git, and models"
```

---

### Task 5A: OTLP Receiver, Usage Scanner, Trophies, Wrapped & Shots

**Files:**
- Create: `crates/station-core/src/store/{mod.rs,otel.rs,otel_setup.rs,usage.rs,trophies.rs,wrapped.rs,shots.rs}`
- Modify: `crates/station-core/src/lib.rs`

**Interfaces:**
- Consumes: `station_core::{atomic,redact,prefs,shared::burn}`, Oracle fixtures in `d:\mystation\my-station\tests\fixtures\otel\*.json`.
- Produces:
  - `pub struct OtelStore` (`ingest_metrics`, `ingest_logs`, `burn_summary(range)`, `flush()`, caps `500 / 150 / 3000 / 20000 / 5000`, 30-day retention in `data/otel/`)
  - `pub struct TrophyStore` (all 22 `MILESTONES`, FNV-1a 32-bit dedupe, `data/totals.json`, `flush()`)
  - `pub struct UsageScanner` (bounded LRU file cache + 1 MB streaming read buffer), `WrappedBuilder`, `ShotsHelper`, `OtelSetup`.

- [ ] **Step 1: Write failing unit tests using Oracle OTLP fixtures and trophy/wrapped assertions (Review Focus #2)**

Assert:
- Ingesting `metrics-cumulative-{1,2,3}.json`, `metrics-delta-{1,2}.json`, and `logs.json` from `d:\mystation\my-station\tests\fixtures\otel\` matches Oracle sums and writes zero raw prompts/secrets to `data/otel/`.
- `TrophyStore` earns `open`, `d1`, `p100` accurately and flushes atomically to `data/totals.json`.

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test -p station-core store::`
Expected: FAIL.

- [ ] **Step 3: Implement `store/{mod,otel,otel_setup,usage,trophies,wrapped,shots}.rs`**

- [ ] **Step 4: Run tests to verify pass**

Run: `cargo test -p station-core store::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/station-core/src/store/ crates/station-core/src/lib.rs PARITY_LEDGER.md
git commit -m "feat(core): port OTLP store, usage scanner, trophies, wrapped, and shots"
```

---

### Task 5B: Vault, Prompt Report, Redact-First Rewrite, Push, Histories, Accounts, RPC & VSIX

**Files:**
- Create: `crates/station-core/src/store/{vault.rs,prompt_report.rs,rewrite.rs,push.rs,agent_history.rs,codex_history.rs,codex_accounts.rs,antigravity_accounts.rs,antigravity_runs.rs,agent_rpc.rs,vsix.rs}`
- Modify: `crates/station-core/src/store/mod.rs`

**Interfaces:**
- Consumes: `station_core::{atomic,redact,prefs,state}`, Oracle tests in `tests/unit/{vault,prompt-report,rewrite,push,agent-history,codex-history,codex-accounts,antigravity-accounts,antigravity-runs,agent-rpc,vsix}.test.mjs`.
- Produces:
  - `pub struct VaultStore`, `pub fn build_prompt_report(...)`, `pub struct Rewriter` (ALWAYS calls `redact()` before invoking external rewrite/translation transport), `pub struct PushStore`, `AgentHistory`, `CodexHistory`, `CodexAccounts`, `AntigravityAccounts`, `AntigravityWatcher`, `AgentRpc`, `VsixInstaller`.

- [ ] **Step 1: Write failing unit tests including redact-before-rewrite guard (Review Focus #2)**

Assert:
- Calling `Rewriter` with a fake transport receiving `"fix key sk-secret123456"` proves the transport ONLY ever receives `"fix key •••"`.
- Port assertions from `vault`, `prompt-report`, `push`, `agent-history`, `codex-history`, `codex-accounts`, `antigravity-accounts`, `antigravity-runs`, `agent-rpc`, `vsix`.

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test -p station-core store::`
Expected: FAIL.

- [ ] **Step 3: Implement the 11 modules in `crates/station-core/src/store/`**

- [ ] **Step 4: Run tests to verify pass**

Run: `cargo test -p station-core store::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/station-core/src/store/ PARITY_LEDGER.md
git commit -m "feat(core): port vault, redact-first rewrite, push, histories, accounts, and rpc"
```

---

### Task 6: Axum HTTP / SSE / OTLP Server (65+ Endpoints, Security Guards & `/phone` PWA)

**Files:**
- Create: `crates/station-core/src/http/{mod.rs,guard.rs,hooks.rs,api.rs,sse.rs,phone.rs,otel_routes.rs}`
- Modify: `crates/station-core/Cargo.toml`, `crates/station-core/src/lib.rs`

**Interfaces:**
- Consumes: `OfficeState`, `SystemMonitor`, `OtelStore`, `TrophyStore`, `VaultStore`, `AuthStore`, `PrefsStore`.
- Produces:
  - `pub struct ServerHandle { pub addr: std::net::SocketAddr, pub shutdown: tokio::sync::watch::Sender<bool> }`
  - `pub async fn start_http_server(state: std::sync::Arc<AppState>, host: &str, port: u16) -> anyhow::Result<ServerHandle>`
  - `pub fn build_router(state: std::sync::Arc<AppState>) -> axum::Router` (registers all 65+ endpoints listed in Spec Section 6).

- [ ] **Step 1: Write failing HTTP security & endpoint contract tests (Review Focus #1)**

Using `tower::ServiceExt::oneshot` against `build_router(state)`:
- `POST /event` with `Host: evil.com` or `Origin: https://evil.com` → returns `403` and leaves session count `0`.
- `POST /event` with `Host: 127.0.0.1:4310` and valid Claude `SessionStart` JSON → returns `200`, creates session visible in `GET /api/live` and `GET /stream` SSE.
- `POST /v1/metrics` and `POST /v1/logs` reject non-loopback / wrong schema with `400`/`403`, accept valid OTLP JSON with `200`.
- `GET /health` returns `200` `"ok"`.
- Remote LAN/tunnel request without PIN cookie or `?k=<token>` gets `303 /pin` (on `/`) or `401` (on `/api/*`), and non-allowlisted POST via tunnel gets `403`.

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test -p station-core http::`
Expected: FAIL.

- [ ] **Step 3: Implement `http/{guard,hooks,api,sse,phone,otel_routes,mod}.rs`**

Ensure `/api/image` sets `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff` (matching `server/index.mjs:3415`), `/phone` serves the lightweight mobile remote HTML/SW/manifest + `/pin` flow, and graceful shutdown triggers `flush_all()`.

- [ ] **Step 4: Run tests to verify pass**

Run: `cargo test -p station-core http::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/station-core/src/http/ crates/station-core/Cargo.toml crates/station-core/src/lib.rs PARITY_LEDGER.md
git commit -m "feat(core): implement Axum HTTP/SSE/OTLP server with 65+ routes and security guards"
```

---

### Task 7: Native `my-station-rs hook` Subcommand & CLI Installer (`install`/`uninstall`/`doctor`/`service`)

**Files:**
- Create: `crates/station-core/src/hook_client.rs`
- Create: `crates/station-core/src/hooks_cli.rs`
- Create: `crates/station-app/src/commands.rs`
- Modify: `crates/station-app/src/{cli.rs,main.rs}`

**Interfaces:**
- Consumes: `station_core::http::start_http_server`, `station_core::atomic`, `station_app::cli::{Cli, Command}`.
- Produces:
  - `pub struct HookArgs { pub url: String, pub r#async: bool, pub fast: bool, pub wait: Option<u64>, pub job: bool, pub agent: Option<String>, pub event: Option<String>, pub response_json: bool }`
  - `pub async fn run_hook_client(args: &HookArgs, stdin_bytes: &[u8], env: &HashMap<String, String>) -> String` (never returns non-zero on network error; returns exact stdout string)
  - `pub fn install_agent_hooks(agent: &str, settings_override: Option<&Path>, bin_path: &Path, port: u16) -> anyhow::Result<InstallReport>` (all 5 agents: `claude`, `codex`, `opencode`, `zcode`, `antigravity`, including Antigravity `PreToolUse`!)
  - `pub fn uninstall_agent_hooks(agent: &str, settings_override: Option<&Path>, port: u16) -> anyhow::Result<bool>`
  - `pub fn is_agent_hooked(agent: &str, settings_override: Option<&Path>, port: u16) -> bool`
  - `pub fn install_windows_service(bin_path: &Path, host: &str, port: u16, log_path: &Path) -> anyhow::Result<PathBuf>`

- [ ] **Step 1: Write failing tests for `run_hook_client` timeout/unreachable behavior and all 5 agent hook installers (Review Focus #3)**

Assert:
- `run_hook_client` targeting a closed loopback port with `--fast` returns `""` in `< 500 ms` without error; with `--response-json --event=Stop` returns `r#"{"decision":""}"#`; with `--response-json --event=Notification` returns `"{}"`; with `--response-json --event=PreToolUse` returns `""`.
- `run_hook_client` targeting a live test server sends `X-Office-Wait`, `X-Office-Job`, `X-Office-Inbox`, injects `agent` + `hook_event_name` into JSON body, and returns server response text.
- `install_agent_hooks` + `is_agent_hooked` + `uninstall_agent_hooks` pass round-trip on temp settings files for all 5 agents (`claude`, `codex`, `opencode`, `zcode`, `antigravity`), create `.backup-*`, preserve unrelated keys, and include `PreToolUse` for Antigravity.

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test -p station-core hook`
Expected: FAIL.

- [ ] **Step 3: Implement `hook_client.rs`, `hooks_cli.rs`, and wire all CLI commands in `station-app/src/commands.rs`**

Wire `my-station-rs serve [--lan]`, `my-station-rs hook <url> [flags]`, `my-station-rs install --agent <name>`, `my-station-rs uninstall --agent <name>`, `my-station-rs service <install|uninstall|status>`, and `my-station-rs doctor`.

- [ ] **Step 4: Run tests to verify pass**

Run: `cargo test -p station-core hook` and `cargo test -p station-app`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/station-core/ crates/station-app/ PARITY_LEDGER.md
git commit -m "feat(cli): add native Rust hook client, 5-agent hook installer, and Windows service"
```

---

### Task 8: `station-launcher` Windows GUI Harness Discovery & Custom Registry

**Files:**
- Create: `crates/station-launcher/src/{catalog.rs,detect_win32.rs}`
- Modify: `crates/station-launcher/Cargo.toml`, `crates/station-launcher/src/lib.rs`

**Interfaces:**
- Consumes: `station_core::atomic::write_json_atomic`, `station_core::hooks_cli::is_agent_hooked`.
- Produces:
  - `#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)] pub enum LaunchTarget { Exe(PathBuf), Shortcut(PathBuf), MsixAumid { package_family: String, aumid: String } }`
  - `#[derive(Debug, Clone, Serialize, Deserialize)] pub struct HarnessEntry { pub id: String, pub label: String, pub hook_agent: Option<String>, pub target: Option<LaunchTarget>, pub custom: bool, pub process_names: Vec<String> }`
  - `pub struct HarnessCatalog` (`load_or_default(data_dir: &Path) -> Self`, `upsert_custom(&mut self, entry: HarnessEntry) -> Result<()>`, `remove_custom(&mut self, id: &str) -> Result<bool>`)
  - `pub fn detect_builtin_harnesses() -> Vec<HarnessEntry>` (discovers `claude`, `codex`, `opencode`, `zcode`, `antigravity` via `%LOCALAPPDATA%\Programs`, Start Menu `.lnk`, and Windows `GetPackagesByPackageFamily` / registry AppX lookup — **ZERO PowerShell calls**!)

- [ ] **Step 1: Write failing unit tests for discovery, corrupted `harnesses.json` recovery, and custom CRUD (Review Focus #4 & #5)**

Assert:
- `HarnessCatalog::load_or_default` recovers gracefully from malformed `data/harnesses.json` and persists added custom app (`orca`, `code`) atomically across reload.
- `detect_builtin_harnesses()` returns all 5 built-in IDs (`claude`, `codex`, `opencode`, `zcode`, `antigravity`) and detects at least `antigravity`, `opencode`, `zcode`, `claude`, `codex` on this Windows host without spawning `powershell.exe`.

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test -p station-launcher`
Expected: FAIL.

- [ ] **Step 3: Implement `catalog.rs` and `detect_win32.rs`**

Detect MSIX packages (`Claude_*`, `OpenAI.Codex_*`) by reading `%LOCALAPPDATA%\Microsoft\WindowsApps` + registry `HKCU\Software\Classes\ActivatableClasses\Package` / `AppxManifest.xml` (pure Win32/filesystem — zero PowerShell!). Detect `.exe` apps (`Antigravity.exe`, `OpenCode.exe`, `ZCode.exe`) under `%LOCALAPPDATA%\Programs\` and Start Menu `.lnk` shortcuts.

- [ ] **Step 4: Run tests to verify pass**

Run: `cargo test -p station-launcher`
Expected: PASS (all 5 installed harnesses on this machine resolve to real `LaunchTarget`s).

- [ ] **Step 5: Commit**

```bash
git add crates/station-launcher/
git commit -m "feat(launcher): add zero-PowerShell Windows GUI harness detector and custom catalog"
```

---

### Task 9: `station-launcher` Auto-Hook Preflight, Focus-or-Launch & Loopback HTTP Routes

**Files:**
- Create: `crates/station-launcher/src/focus_launch.rs`
- Modify: `crates/station-launcher/src/lib.rs`
- Modify: `crates/station-core/src/http/{mod.rs,api.rs}` (define `HarnessApi` trait on `AppState` — zero dependency cycle between `station-core` and `station-launcher`)
- Modify: `crates/station-app/src/commands.rs` (inject `Arc<HarnessService<Win32WindowLauncher>>` as `Arc<dyn HarnessApi>` into `AppState`)

**Interfaces:**
- Consumes: `HarnessCatalog`, `detect_builtin_harnesses`, `station_core::hooks_cli::{is_agent_hooked, install_agent_hooks}`, `station_core::http::AppState`.
- Produces:
  - `#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)] pub enum HarnessStatus { RunningHooked, InstalledHooked, NeedsHook, NotInstalled }`
  - `#[derive(Debug, Clone, Serialize, PartialEq, Eq)] pub enum LaunchOutcome { FocusedExisting { pid: u32 }, LaunchedNew, NotInstalled }`
  - `pub trait HarnessApi: Send + Sync` in `station_core::http` (`list_json(&self) -> serde_json::Value`, `launch(&self, id: &str) -> anyhow::Result<serde_json::Value>`, `mutate_custom(&self, body: serde_json::Value) -> anyhow::Result<serde_json::Value>`)
  - `pub trait WindowLauncher: Send + Sync` (`find_running_window(&self, process_names: &[String]) -> Option<(u32, isize)>`, `focus_window(&self, hwnd: isize) -> Result<()>`, `launch_target(&self, target: &LaunchTarget) -> Result<()>`)
  - `pub struct Win32WindowLauncher;` (`EnumWindows` + `GetWindowThreadProcessId` + `IsWindowVisible` + `ShowWindow(SW_RESTORE)` + `SetForegroundWindow`, launch via `ShellExecuteW` with `SW_SHOWNORMAL` — NEVER spawns `cmd`/`pwsh`/`wt`)
  - `pub struct HarnessService<L: WindowLauncher>` implementing `HarnessApi` (`list() -> Vec<HarnessView>`, `open(&self, id: &str) -> Result<LaunchOutcome>`)
  - Loopback-only HTTP routes: `GET /api/harnesses`, `POST /api/harnesses/launch` (`{ id }`), `POST /api/harnesses/custom` (`{ op: "upsert" | "remove", ... }`).

- [ ] **Step 1: Write failing tests for focus-before-launch, auto-hook preflight, missing app error, and Host/Origin rejection (Review Focus #1 & #5)**

Using a mock `WindowLauncher` + temp settings file:
- Clicking `antigravity` when not hooked and not running → runs `install_agent_hooks`, calls `launch_target`, returns `LaunchOutcome::LaunchedNew`.
- Clicking `antigravity` when already running (mock returns `Some((4242, 999))`) → calls `focus_window(999)`, does NOT call `launch_target`, returns `LaunchOutcome::FocusedExisting { pid: 4242 }`.
- Clicking an uninstalled harness → returns `LaunchOutcome::NotInstalled` without panicking.
- `POST /api/harnesses/launch` with `Origin: https://evil.com` → returns `403`, never invokes `open()`.

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test -p station-launcher`
Expected: FAIL.

- [ ] **Step 3: Implement `focus_launch.rs`, `HarnessService`, and loopback-guarded `/api/harnesses/*` endpoints**

For MSIX targets, invoke `ShellExecuteW("open", "shell:AppsFolder\\<AUMID>", ...)` (opens the native Store/MSIX app cleanly with zero terminal window). For `.exe`/`.lnk`, invoke `ShellExecuteW("open", path, ...)` directly.

- [ ] **Step 4: Run tests to verify pass**

Run: `cargo test -p station-launcher` and `cargo test -p station-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/station-launcher/ crates/station-core/ crates/station-app/
git commit -m "feat(launcher): add auto-hook preflight, Win32 focus-or-launch, and /api/harnesses routes"
```

---

### Task 10: G1 Contract Oracle Runner & 70-Second Zero-PowerShell Idle RAM Gate

**Files:**
- Create: `d:\mystation\my-station-rs\scripts\run-oracle-contract-tests.mjs`
- Modify: `d:\mystation\my-station-rs\PARITY_LEDGER.md`

**Interfaces:**
- Consumes: Compiled `my-station-rs.exe` (`serve` + `hook`), Oracle fixtures in `d:\mystation\my-station\tests\fixtures\`.
- Produces: Automated end-to-end G1 certification report covering HTTP/SSE/OTLP/security/persistence/launcher contracts + live Windows Private RAM & PowerShell-spawn audit.

- [ ] **Step 1: Write `scripts/run-oracle-contract-tests.mjs`**

Script spawns `my-station-rs.exe serve` on an ephemeral port with a temp `OFFICE_DATA_DIR`, then runs:
1. Full `/health`, `/event` (all 5 agents + Host/Origin rejection), `/hook/{permission,question,loop,start,denied}`, `/v1/{metrics,logs}` (with Oracle OTLP fixtures), `/stream` SSE, `/api/{live,sys,burn,vault,trophies,prefs,pins,undo,chat,wrapped,replay/days,harnesses}`.
2. Native `my-station-rs.exe hook` subprocess test (live server + closed port + `--response-json`).
3. Graceful shutdown (`SIGINT`/shutdown) and restart verifying `prefs.json`, `pins.json`, `totals.json`, and `otel/` persisted atomically.
4. 70-second idle soak measuring: (a) `my-station-rs.exe` Private RAM `≤ 35 MB`, (b) `0` `powershell.exe` child processes spawned under `my-station-rs.exe`.

- [ ] **Step 2: Run full workspace tests + Oracle contract & soak runner**

Run: `cargo test --workspace` then `node scripts/run-oracle-contract-tests.mjs`
Expected: 100% PASS, idle RAM `≤ 35 MB`, `0` PowerShell spawns.

- [ ] **Step 3: Update `PARITY_LEDGER.md` (mark all 61 P1 files + 65+ endpoints `[x]`) and commit**

```bash
git add scripts/run-oracle-contract-tests.mjs PARITY_LEDGER.md
git commit -m "test(core): certify G1 backend parity, launcher, and <=35MB zero-PowerShell soak"
```

---

## Next Plans (Authored via `writing-plans` Immediately After Preceding Gate Passes)

- **Plan 2 (`station-canvas2d`):** 25 procedural 2D texture generators + Golden PNG Oracle.
- **Plan 3 (`station-3d` Part 1):** Layouts (`cozy`/`pro`/`hq`), furniture, 22 props (`tv-games`), lighting/bloom, camera, raycast.
- **Plan 4 (`station-3d` Part 2):** Chibi rig (shared indexed meshes), 32 `people/`, 36 `backdrops/` (true unload), 15 `life/`, `demo/`, `replay/`, `audio/`.
- **Plan 5 (`station-ui` + `station-app`):** 42 `ui/`, 7 `panel/`, 55 `styles/`, 105 `i18n/`, 2D Lite unload, Harness Launcher Dock, System Tray & Toast Approve.
- **Plan 6 (E2E Certification):** Live multi-agent E2E, side-by-side visual diff, and full RAM/leak soak gate.
