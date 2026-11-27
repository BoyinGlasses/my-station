// Shared registry of VS Code-family editors used across server modules and bin/cli.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const EDITORS = [
  { dot: '.antigravity-ide', app: 'Antigravity IDE', data: 'Antigravity IDE', label: 'Antigravity IDE', cli: 'antigravity-ide' },
  { dot: '.antigravity', app: 'Antigravity', data: 'Antigravity', label: 'Antigravity' },
  { dot: '.vscode-insiders', app: 'Visual Studio Code - Insiders', data: 'Code - Insiders', label: 'VS Code Insiders', cli: 'code-insiders' },
  { dot: '.vscode', app: 'Visual Studio Code', data: 'Code', label: 'VS Code', cli: 'code' },
  { dot: '.cursor', app: 'Cursor', data: 'Cursor', label: 'Cursor', cli: 'cursor' },
  { dot: '.windsurf', app: 'Windsurf', data: 'Windsurf', label: 'Windsurf', cli: 'windsurf' },
  { dot: '.kiro', app: 'Kiro', data: 'Kiro', label: 'Kiro' },
  { dot: '.trae', app: 'Trae', data: 'Trae', label: 'Trae' },
  { dot: '.positron', app: 'Positron', data: 'Positron', label: 'Positron' },
];

export const editorByDot = (dot) => EDITORS.find((e) => e.dot === dot) || null;

export function editorSettingsDir(home = os.homedir(), env = process.env) {
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support');
  if (process.platform === 'win32') return env.APPDATA || path.join(home, 'AppData', 'Roaming');
  return path.join(home, '.config');
}

export function claudeEditorSettings({ home = os.homedir(), env = process.env } = {}) {
  const base = editorSettingsDir(home, env);
  return EDITORS.filter((e) => {
    try { return fs.readdirSync(path.join(home, e.dot, 'extensions')).some((x) => /^anthropic\.claude-code-/.test(x)); } catch { return false; }
  }).map((e) => ({ app: e.label, file: path.join(base, e.data, 'User', 'settings.json') }));
}

export function allEditorSettings({ home = os.homedir(), env = process.env } = {}) {
  const base = editorSettingsDir(home, env);
  return EDITORS.map((e) => path.join(base, e.data, 'User', 'settings.json'));
}
