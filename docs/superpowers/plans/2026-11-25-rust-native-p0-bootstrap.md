# Rust Native Rewrite — Plan 0: Workspace Bootstrap, 8 GB Build Guard & Bevy Screenshot Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Initialize the sibling Rust workspace `d:\mystation\my-station-rs` with 8 GB RAM / `D:` disk build guardrails, bundled fonts/assets/i18n, full Parity Ledger scaffold, CLI entrypoint, and a working Bevy + `bevy_egui` binary capable of rendering and exporting a verified PNG via `--capture-scene smoke`.

**Architecture:** A 6-crate Cargo workspace (`station-core`, `station-launcher`, `station-canvas2d`, `station-3d`, `station-ui`, `station-app`) targeting `D:\mystation\cargo-target` with bounded compile parallelism. `station-app` owns CLI parsing, single-instance lock, GPU adapter selection, and a deterministic frame-capture plugin that serves as the visual oracle foundation for Plans 2–6.

**Tech Stack:** Rust 1.97+ (`stable-x86_64-pc-windows-msvc`), Cargo Workspace, Bevy `0.16`, `bevy_egui`, `clap` `4`, `image`, `woff2` (or `ttf-parser`/font conversion script using Python `fontTools` / Node `wawoff2`), `windows-sys` (named mutex).

**Spec:** `d:\mystation\my-station\docs\superpowers\specs\2026-11-25-rust-native-rewrite-design.md`

## Global Constraints

- Target repo path is `d:\mystation\my-station-rs`; NEVER modify runtime source files in `d:\mystation\my-station` (read-only Golden Oracle).
- `CARGO_TARGET_DIR` MUST be `D:\mystation\cargo-target` (configured in `.cargo/config.toml`); NEVER write build artifacts onto `C:`.
- `.cargo/config.toml` MUST set `[build] jobs = 2`; NEVER run two `cargo` invocations concurrently on this 8 GB RAM host.
- `[profile.dev]` MUST set `debug = 0`, `split-debuginfo = "packed"`, `incremental = true`; `[profile.dev.package."*"]` MUST set `opt-level = 1`; `[profile.release]` MUST set `lto = "thin"`, `codegen-units = 4`, `strip = "symbols"`.
- Default HTTP port constant is `4310` (`OFFICE_PORT`), default host is `127.0.0.1` (`OFFICE_HOST`).
- Never touch or commit user `data/` directories or secrets.
- Every task ends with passing `cargo test` / verification and an atomic Conventional Commit inside `d:\mystation\my-station-rs`.

## Review Focus

1. **8 GB RAM / `D:` disk budget breach during Bevy first compile** — building `station-app` must keep `D:\mystation\cargo-target` under 10 GB and complete cleanly with `jobs = 2` without triggering Windows OOM; verified in Task 6.
2. **Vietnamese diacritics & Thai script rendering as missing-glyph tofu boxes** — bundled `.woff2` fonts in `my-station` are subsetted (`latin`, `latin-ext`, `vietnamese`, `thai`); merging/converting to TTF must preserve all Vietnamese (`Tiếng Việt: Ă Ắ Ặ Đ Ơ Ư Ỹ`) and Thai (`ภาษาไทย`) codepoints; pinned by unit test in Task 2.
3. **`--capture-scene` hanging indefinitely or writing an all-black/empty PNG on dual-GPU Windows** — screenshot capture must wait for at least 3 rendered frames, save non-black RGBA pixels, and exit cleanly within 30 s; pinned by integration test in Task 5.
4. **Invalid `--gpu` adapter flag or missing discrete GPU** — passing an unrecognized adapter value must fail CLI parsing with non-zero exit, and requesting `discrete`/`integrated` when only one adapter exists must fall back safely without panicking; pinned by unit tests in Task 3 and Task 4.
5. **Double-launching `my-station-rs` GUI while an instance is already running** — second GUI invocation must detect the named Win32 mutex and exit cleanly with code `0` instead of binding port `4310` twice or spawning a duplicate Bevy window; pinned by unit test in Task 3.

---

## File Structure

All paths below are relative to `d:\mystation\my-station-rs\`:

- Create: `.gitignore` — ignores `target/`, `data/`, `artifacts/`, `*.tmp`, `.DS_Store`.
- Create: `.cargo/config.toml` — pins `target-dir = "D:/mystation/cargo-target"` and `jobs = 2`.
- Create: `Cargo.toml` — workspace root with 6 crates, pinned dependency versions, and dev/release profiles.
- Create: `PARITY_LEDGER.md` — machine-checkable checklist tracking all 449 source files and 65+ endpoints from Spec Section 6.
- Create: `crates/station-core/Cargo.toml`, `crates/station-core/src/lib.rs` — core crate stub with `DEFAULT_PORT = 4310`, `DEFAULT_HOST = "127.0.0.1"`.
- Create: `crates/station-launcher/Cargo.toml`, `crates/station-launcher/src/lib.rs` — launcher crate stub.
- Create: `crates/station-canvas2d/Cargo.toml`, `crates/station-canvas2d/src/lib.rs` — 2D rasterizer crate stub.
- Create: `crates/station-3d/Cargo.toml`, `crates/station-3d/src/lib.rs` — Bevy 3D crate stub + `SmokeScenePlugin`.
- Create: `crates/station-ui/Cargo.toml`, `crates/station-ui/src/lib.rs` — `bevy_egui` UI crate stub + `ThemeFonts` loader.
- Create: `crates/station-app/Cargo.toml`, `crates/station-app/src/main.rs`, `crates/station-app/src/cli.rs`, `crates/station-app/src/instance.rs`, `crates/station-app/src/capture.rs` — CLI, single-instance Win32 mutex, GPU preference mapping, Bevy + `bevy_egui` bootstrap, and `--capture-scene` PNG capture plugin.
- Create: `scripts/sync-assets.mjs` — deterministic script copying `public/assets/`, `src/i18n/`, and converting `src/styles/fonts/*.woff2` → `assets/fonts/*.ttf` from `d:\mystation\my-station`.
- Create: `assets/fonts/`, `assets/brands/`, `assets/thumbs/`, `assets/vehicles/`, `assets/i18n/` — synced runtime assets.
- Create: `crates/station-app/tests/capture_smoke.rs` — end-to-end smoke capture verification test.

---

### Task 1: Workspace Skeleton, 8 GB Build Guard & Parity Ledger

**Files:**
- Create: `d:\mystation\my-station-rs\.gitignore`
- Create: `d:\mystation\my-station-rs\.cargo\config.toml`
- Create: `d:\mystation\my-station-rs\Cargo.toml`
- Create: `d:\mystation\my-station-rs\PARITY_LEDGER.md`
- Create: `d:\mystation\my-station-rs\crates\station-core\{Cargo.toml,src\lib.rs}`
- Create: `d:\mystation\my-station-rs\crates\station-launcher\{Cargo.toml,src\lib.rs}`
- Create: `d:\mystation\my-station-rs\crates\station-canvas2d\{Cargo.toml,src\lib.rs}`
- Create: `d:\mystation\my-station-rs\crates\station-3d\{Cargo.toml,src\lib.rs}`
- Create: `d:\mystation\my-station-rs\crates\station-ui\{Cargo.toml,src\lib.rs}`
- Create: `d:\mystation\my-station-rs\crates\station-app\{Cargo.toml,src\main.rs}`

**Interfaces:**
- Consumes: Spec Sections 2, 3, 4, 6.
- Produces:
  - `station_core::DEFAULT_PORT: u16 = 4310`
  - `station_core::DEFAULT_HOST: &str = "127.0.0.1"`
  - `station_core::WORKSPACE_CRATES: [&str; 6]`

- [ ] **Step 1: Initialize Git repo and create `.gitignore`, `.cargo/config.toml`, workspace `Cargo.toml`, and 6 stub crates**

In `d:\mystation\my-station-rs`:
- Run `git init -b main`.
- Write `.cargo/config.toml` with `[build] target-dir = "D:/mystation/cargo-target"` and `jobs = 2`.
- Write root `Cargo.toml` listing members `["crates/station-core", "crates/station-launcher", "crates/station-canvas2d", "crates/station-3d", "crates/station-ui", "crates/station-app"]`, `resolver = "2"`, and exact profiles (`dev`: `debug = 0`, `split-debuginfo = "packed"`, `incremental = true`; `dev.package."*": opt-level = 1`; `release`: `lto = "thin"`, `codegen-units = 4`, `strip = "symbols"`).
- Write `crates/station-core/src/lib.rs` exporting `DEFAULT_PORT = 4310`, `DEFAULT_HOST = "127.0.0.1"`, and a failing test asserting the ledger exists and contains all 449 entries.

- [ ] **Step 2: Write the failing workspace & ledger integrity test in `crates/station-core/src/lib.rs`**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn default_network_constants_match_spec() {
        assert_eq!(DEFAULT_PORT, 4310);
        assert_eq!(DEFAULT_HOST, "127.0.0.1");
    }

    #[test]
    fn parity_ledger_tracks_every_source_file_without_omissions() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let ledger = std::fs::read_to_string(root.join("PARITY_LEDGER.md"))
            .expect("PARITY_LEDGER.md must exist at workspace root");
        let checked_or_pending = ledger.lines().filter(|l| l.starts_with("- [")).count();
        assert!(
            checked_or_pending >= 449,
            "expected >= 449 tracked files in PARITY_LEDGER.md, got {checked_or_pending}"
        );
    }
}
```

- [ ] **Step 3: Run test to verify it fails before `PARITY_LEDGER.md` is generated**

Run: `cargo test -p station-core`
Expected: FAIL on `parity_ledger_tracks_every_source_file_without_omissions` (`PARITY_LEDGER.md must exist at workspace root`).

- [ ] **Step 4: Generate `PARITY_LEDGER.md` directly from `d:\mystation\my-station` file tree**

Generate `d:\mystation\my-station-rs\PARITY_LEDGER.md` listing every file in `server/` (44), `src/shared/` (11), `bin/` (2), `hooks/` (4), `src/office/` (185), `src/panel/` (7), `src/components/` (20), `app/` (11), `src/styles/` (55), `src/i18n/` (105), and `public/` (17) grouped by Plan (`P0`–`P5`), each formatted as `- [ ] <relative-path> -> (pending)`.

- [ ] **Step 5: Run tests and verify `target/` lands on `D:\mystation\cargo-target`**

Run: `cargo test --workspace` and verify `Test-Path D:\mystation\cargo-target` is `True` and `Test-Path d:\mystation\my-station-rs\target` is `False`.
Expected: PASS (2 tests in `station-core`), zero files written to `C:` or local `target/`.

- [ ] **Step 6: Commit**

```bash
git add .gitignore .cargo/config.toml Cargo.toml Cargo.lock PARITY_LEDGER.md crates/
git commit -m "chore(workspace): bootstrap 6-crate repo with 8gb guardrails and parity ledger"
```

---

### Task 2: Font Conversion Pipeline & Runtime Asset / i18n Sync

**Files:**
- Create: `d:\mystation\my-station-rs\scripts\sync-assets.mjs`
- Create: `d:\mystation\my-station-rs\crates\station-ui\src\fonts.rs`
- Modify: `d:\mystation\my-station-rs\crates\station-ui\Cargo.toml`
- Modify: `d:\mystation\my-station-rs\crates\station-ui\src\lib.rs`
- Create: `d:\mystation\my-station-rs\assets\fonts\*` (converted `.ttf` fonts + manifest)
- Create: `d:\mystation\my-station-rs\assets\{brands,thumbs,vehicles,i18n}\*`

**Interfaces:**
- Consumes: `d:\mystation\my-station\{src\styles\fonts,src\i18n,public\assets}`.
- Produces:
  - `pub struct FontBundle { pub ui_regular: Vec<Vec<u8>>, pub ui_bold: Vec<Vec<u8>>, pub mono_regular: Vec<Vec<u8>>, pub thai_regular: Vec<u8> }` *(each `Vec<Vec<u8>>` stores ordered TTF subset faces `[latin, latin-ext, vietnamese]` loaded sequentially into `egui::FontDefinitions` fallback chains)*
  - `pub fn load_font_bundle(assets_dir: &std::path::Path) -> anyhow::Result<FontBundle>`
  - `pub fn verify_required_glyphs(bundle: &FontBundle) -> anyhow::Result<()>`

- [ ] **Step 1: Write the failing font & glyph coverage test (Review Focus #2)**

In `crates/station-ui/src/fonts.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn bundled_fonts_cover_vietnamese_thai_and_ascii_glyphs() {
        let assets = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../assets");
        let bundle = load_font_bundle(&assets).expect("load_font_bundle must succeed");
        verify_required_glyphs(&bundle).expect("all Vietnamese, Thai, and ASCII glyphs must exist");
        assert!(assets.join("i18n").exists());
        assert!(assets.join("brands/grab.svg").exists());
        assert!(assets.join("vehicles/cars.json").exists());
    }
}
```
Where `verify_required_glyphs` parses each TTF face in `bundle` with `ttf_parser::Face::parse` and asserts at least one face in the fallback chain returns `glyph_index(ch).is_some()` for every char in `"Hello 0123456789"`, `"Tiếng Việt: Ă Ắ Ặ Đ Ơ Ư Ỹ ệ ổ"`, and `"ภาษาไทย"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p station-ui bundled_fonts_cover_vietnamese_thai_and_ascii_glyphs`
Expected: FAIL (assets directory / TTF fonts not synced yet).

- [ ] **Step 3: Implement `scripts/sync-assets.mjs`, `tools/woff2-to-ttf` (or pure-Rust `woff2_patched` converter in `station-ui` build/tool), and `crates/station-ui/src/fonts.rs`**

- `scripts/sync-assets.mjs` copies `public/assets/{brands,thumbs,vehicles}` and all `src/i18n/*` from `--from D:\mystation\my-station` into `assets/`, and decodes every `src/styles/fonts/*.woff2` into `assets/fonts/*.ttf` (keeping exact filenames with `.ttf` extension: `BeVietnamPro-400-{latin,latin-ext,vietnamese}.ttf`, `BeVietnamPro-700-{latin,latin-ext,vietnamese}.ttf`, `JetBrainsMono-400-{latin,latin-ext,vietnamese}.ttf`, `PlexThaiLooped-400-thai.ttf`).
- Implement `load_font_bundle(assets_dir: &Path) -> Result<FontBundle>` and `verify_required_glyphs(bundle: &FontBundle) -> Result<()>` in `crates/station-ui/src/fonts.rs` using `ttf-parser`.

- [ ] **Step 4: Run sync script and verify font/glyph test passes**

Run: `node scripts/sync-assets.mjs` then `cargo test -p station-ui bundled_fonts_cover_vietnamese_thai_and_ascii_glyphs`
Expected: PASS (every Vietnamese, Thai, and ASCII glyph resolves with non-zero glyph ID).

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-assets.mjs assets/ crates/station-ui/
git commit -m "feat(ui): sync oracle assets, i18n, and verified Vietnamese/Thai TTF fonts"
```

---

### Task 3: `station-app` CLI Specification & Single-Instance Win32 Guard

**Files:**
- Create: `d:\mystation\my-station-rs\crates\station-app\src\cli.rs`
- Create: `d:\mystation\my-station-rs\crates\station-app\src\instance.rs`
- Modify: `d:\mystation\my-station-rs\crates\station-app\Cargo.toml`
- Modify: `d:\mystation\my-station-rs\crates\station-app\src\main.rs`

**Interfaces:**
- Consumes: `station_core::{DEFAULT_HOST, DEFAULT_PORT}`.
- Produces:
  - `#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)] pub enum GpuPreference { Auto, Integrated, Discrete }`
  - `#[derive(Debug, Clone, clap::Args)] pub struct HookCliArgs { pub url: String, #[arg(long)] pub r#async: bool, #[arg(long)] pub fast: bool, #[arg(long)] pub wait: Option<u64>, #[arg(long)] pub job: bool, #[arg(long)] pub agent: Option<String>, #[arg(long)] pub event: Option<String>, #[arg(long)] pub response_json: bool }`
  - `#[derive(Debug, clap::Parser)] pub struct Cli { pub command: Option<Command>, #[arg(long, env = "OFFICE_PORT", default_value_t = 4310)] pub port: u16, #[arg(long, env = "OFFICE_HOST", default_value = "127.0.0.1")] pub host: String, #[arg(long, value_enum, default_value_t = GpuPreference::Auto)] pub gpu: GpuPreference, #[arg(long)] pub capture_scene: Option<String>, #[arg(long)] pub out: Option<std::path::PathBuf> }`
  - `#[derive(Debug, clap::Subcommand)] pub enum Command { Gui, Serve { #[arg(long)] lan: bool }, Hook(HookCliArgs), Install { #[arg(long, default_value = "claude")] agent: String, #[arg(long)] settings: Option<std::path::PathBuf> }, Uninstall { #[arg(long, default_value = "claude")] agent: String, #[arg(long)] settings: Option<std::path::PathBuf> }, Service { action: String, #[arg(long)] lan: bool }, Doctor }`
  - `pub struct InstanceLock { ... }` with `pub fn try_acquire(mutex_name: &str) -> anyhow::Result<Option<InstanceLock>>` (returns `Ok(None)` when another process already holds `mutex_name`; releases on `Drop`).

- [ ] **Step 1: Write failing unit tests for CLI flags, invalid `--gpu`, and single-instance mutex (Review Focus #4 & #5)**

In `crates/station-app/src/cli.rs` and `crates/station-app/src/instance.rs`:
```rust
#[test]
fn cli_defaults_match_spec_and_reject_invalid_gpu() {
    let parsed = Cli::try_parse_from(["my-station-rs"]).unwrap();
    assert_eq!(parsed.port, 4310);
    assert_eq!(parsed.host, "127.0.0.1");
    assert_eq!(parsed.gpu, GpuPreference::Auto);
    assert!(Cli::try_parse_from(["my-station-rs", "--gpu", "bogus"]).is_err());
    let cap = Cli::try_parse_from([
        "my-station-rs", "--capture-scene", "smoke", "--out", "out.png", "--gpu", "integrated",
    ]).unwrap();
    assert_eq!(cap.capture_scene.as_deref(), Some("smoke"));
    assert_eq!(cap.gpu, GpuPreference::Integrated);
}

#[test]
fn second_instance_lock_returns_none_until_first_drops() {
    let name = format!("Local\\my-station-rs-test-{}", std::process::id());
    let first = InstanceLock::try_acquire(&name).unwrap();
    assert!(first.is_some());
    let second = InstanceLock::try_acquire(&name).unwrap();
    assert!(second.is_none());
    drop(first);
    let third = InstanceLock::try_acquire(&name).unwrap();
    assert!(third.is_some());
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p station-app`
Expected: FAIL (`cli` and `instance` modules do not exist yet).

- [ ] **Step 3: Implement `cli.rs` (`clap` derive) and `instance.rs` (`windows-sys` `CreateMutexW` + `ERROR_ALREADY_EXISTS` check + `CloseHandle` in `Drop`)**

Use `windows-sys` (`Win32_System_Threading`, `Win32_Foundation`) on Windows; return `Ok(Some(...))` stub under `#[cfg(not(windows))]`. Note that on Windows, `CreateMutexW` succeeds with `GetLastError() == ERROR_ALREADY_EXISTS` even within the same process if checked via `CreateMutexW` alone — to test duplicate-lock reliably inside a single test process, keep a process-local `Mutex<HashSet<String>>` check in front of `CreateMutexW` (or test via spawning a child process holding the mutex). Verify both in-process and cross-process contention work cleanly!

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p station-app`
Expected: PASS (`cli_defaults_match_spec_and_reject_invalid_gpu`, `second_instance_lock_returns_none_until_first_drops`).

- [ ] **Step 5: Commit**

```bash
git add crates/station-app/
git commit -m "feat(app): add clap CLI contract and Win32 single-instance mutex"
```

---

### Task 4: Bevy + `bevy_egui` Minimal Shell & GPU Adapter Selector

**Files:**
- Modify: `d:\mystation\my-station-rs\crates\station-3d\Cargo.toml`
- Modify: `d:\mystation\my-station-rs\crates\station-3d\src\lib.rs`
- Modify: `d:\mystation\my-station-rs\crates\station-ui\Cargo.toml`
- Modify: `d:\mystation\my-station-rs\crates\station-ui\src\lib.rs`
- Modify: `d:\mystation\my-station-rs\crates\station-app\Cargo.toml`
- Create: `d:\mystation\my-station-rs\crates\station-app\src\gpu.rs`
- Modify: `d:\mystation\my-station-rs\crates\station-app\src\main.rs`

**Interfaces:**
- Consumes: `station_app::cli::GpuPreference`, `station_ui::fonts::FontBundle`.
- Produces:
  - `pub fn wgpu_power_preference(pref: GpuPreference) -> bevy::render::settings::PowerPreference`
  - `pub struct SmokeScenePlugin;` (spawns 1 directional light, 1 camera at `(4.0, 3.0, 6.0)` looking at origin, 1 terracotta-colored box + floor plane in `station-3d`)
  - `pub struct SmokeHudPlugin { pub assets_dir: std::path::PathBuf }` (registers `FontBundle` into `egui::Context` and renders top-left badge `"my-station-rs · Tiếng Việt · ภาษาไทย"` in `station-ui`)

- [ ] **Step 1: Write failing unit test for GPU preference mapping (Review Focus #4)**

In `crates/station-app/src/gpu.rs`:
```rust
#[test]
fn gpu_preference_maps_to_wgpu_power_preference() {
    use bevy::render::settings::PowerPreference;
    assert_eq!(wgpu_power_preference(GpuPreference::Auto), PowerPreference::None);
    assert_eq!(wgpu_power_preference(GpuPreference::Integrated), PowerPreference::LowPower);
    assert_eq!(wgpu_power_preference(GpuPreference::Discrete), PowerPreference::HighPerformance);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p station-app gpu_preference_maps_to_wgpu_power_preference`
Expected: FAIL (`gpu` module not defined).

- [ ] **Step 3: Add Bevy `0.16` (minimal features: `bevy_winit`, `bevy_render`, `bevy_core_pipeline`, `bevy_pbr`, `bevy_asset`, `bevy_picking`, `tonemapping_luts`, `png`, `x11`/`windows` defaults — exclude unused heavy audio/physics/gltf until needed) + `bevy_egui`, implement `gpu.rs`, `SmokeScenePlugin`, and `SmokeHudPlugin`**

Configure `RenderPlugin` with `WgpuSettings { power_preference: wgpu_power_preference(cli.gpu), ..default() }`. In `SmokeHudPlugin`, load `FontBundle` once on startup into `egui::FontDefinitions` so Vietnamese & Thai render cleanly without tofu boxes.

- [ ] **Step 4: Run `cargo check --workspace` and `cargo test -p station-app` (remember: single compiler lock!)**

Run: `cargo test -p station-app`
Expected: PASS, clean compile with `jobs = 2`, verify `D:\mystation\cargo-target` size stays `< 10 GB`.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml Cargo.lock crates/
git commit -m "feat(3d): wire minimal Bevy + bevy_egui shell with GPU adapter selector"
```

---

### Task 5: Deterministic `--capture-scene` Screenshot Harness

**Files:**
- Create: `d:\mystation\my-station-rs\crates\station-app\src\capture.rs`
- Modify: `d:\mystation\my-station-rs\crates\station-app\src\main.rs`
- Create: `d:\mystation\my-station-rs\crates\station-app\tests\capture_smoke.rs`

**Interfaces:**
- Consumes: `SmokeScenePlugin`, `SmokeHudPlugin`, `Cli { capture_scene, out }`.
- Produces:
  - `pub struct CapturePlugin { pub scene: String, pub out_path: std::path::PathBuf, pub settle_frames: u32 }`
  - `pub fn validate_non_empty_png(path: &std::path::Path) -> anyhow::Result<(u32, u32)>` (decodes PNG, asserts width >= 320, height >= 240, and > 5% non-black/non-uniform pixels)

- [ ] **Step 1: Write failing integration test for `--capture-scene smoke` (Review Focus #3)**

In `crates/station-app/tests/capture_smoke.rs`:
```rust
#[test]
fn capture_scene_smoke_writes_non_black_png_and_exits_cleanly() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("smoke.png");
    let status = std::process::Command::new(env!("CARGO_BIN_EXE_my-station-rs"))
        .args(["--capture-scene", "smoke", "--out", out.to_str().unwrap()])
        .status()
        .expect("spawn my-station-rs");
    assert!(status.success(), "capture exited with {status}");
    let img = image::open(&out).expect("valid PNG").to_rgba8();
    assert!(img.width() >= 640 && img.height() >= 360);
    let non_black = img.pixels().filter(|p| p[0] > 10 || p[1] > 10 || p[2] > 10).count();
    let unique_buckets: std::collections::HashSet<(u8, u8, u8)> =
        img.pixels().map(|p| (p[0] / 32, p[1] / 32, p[2] / 32)).collect();
    assert!(non_black > (img.width() * img.height() / 10) as usize, "image appears black");
    assert!(unique_buckets.len() >= 3, "image appears flat single color");
}
```

- [ ] **Step 2: Run integration test to verify it fails**

Run: `cargo test -p station-app --test capture_smoke`
Expected: FAIL (`--capture-scene` not wired; `smoke.png` not created).

- [ ] **Step 3: Implement `CapturePlugin` using Bevy `Screenshot::primary_window()` + `save_to_disk` + `AppExit::Success` after capture completes**

Wait `settle_frames = 5` frames (ensuring `bevy_egui` fonts & 3D scene both render), trigger `commands.spawn(Screenshot::primary_window()).observe(save_to_disk(out_path))`, wait until the file is written & flushed (or observe `ScreenshotCaptured`), then emit `AppExit::Success`.

- [ ] **Step 4: Run integration test and visually inspect output PNG**

Run: `cargo test -p station-app --test capture_smoke` AND run `my-station-rs --capture-scene smoke --out D:\mystation\my-station-rs\artifacts\g0-smoke.png` and inspect the PNG with `read_file` to confirm 3D cube + Vietnamese/Thai `egui` HUD render cleanly.
Expected: PASS in < 30 s; PNG shows lit 3D geometry + crisp Vietnamese & Thai text.

- [ ] **Step 5: Commit**

```bash
git add crates/station-app/src/capture.rs crates/station-app/src/main.rs crates/station-app/tests/capture_smoke.rs
git commit -m "feat(app): add deterministic --capture-scene PNG visual oracle harness"
```

---

### Task 6: G0 Resource & Build Budget Verification Gate

**Files:**
- Modify: `d:\mystation\my-station-rs\PARITY_LEDGER.md` (mark P0 assets/i18n/fonts synced)

**Interfaces:**
- Consumes: Entire `d:\mystation\my-station-rs` workspace built in Tasks 1–5.
- Produces: Verified G0 gate evidence (target dir size, peak RAM, test summary, visual smoke PNG).

- [ ] **Step 1: Verify disk budget, RAM footprint, and workspace tests (Review Focus #1)**

Run:
1. `cargo test --workspace` (Expected: all unit + `capture_smoke` PASS, 0 fail).
2. Measure `D:\mystation\cargo-target` size in GB (Expected: `< 10 GB`; verify `d:\mystation\my-station-rs\target` does not exist).
3. Launch `my-station-rs --capture-scene smoke` and record Windows Private MB via `Get-CimInstance Win32_Process` (Expected: `< 220 MB` for minimal Bevy + `bevy_egui` scene).

- [ ] **Step 2: Update `PARITY_LEDGER.md` for P0 items and commit**

```bash
git add PARITY_LEDGER.md
git commit -m "docs(ledger): mark P0 bootstrap, fonts, assets, and capture harness verified"
```
