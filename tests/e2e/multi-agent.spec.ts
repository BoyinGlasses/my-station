import { test, expect } from '@playwright/test';

test('project work chooser sends the selected agent to the task API', async ({ page }) => {
  const sent: Record<string, unknown>[] = [];
  await page.route('**/api/models?**', (route) => route.fulfill({ json: { ok: true, models: [{ id: 'custom/my-model', name: 'Custom Model' }] } }));
  await page.route('**/api/tasks**', async (route) => {
    if (route.request().method() === 'POST') {
      sent.push(route.request().postDataJSON());
      await route.fulfill({ json: { ok: true, task: { id: 'fake' } } });
      return;
    }
    await route.fulfill({ json: { ok: true, allowed: true, running: [], sessions: [], projects: [{ dir: '/project', name: 'project' }], agents: [
      { id: 'claude', name: 'Claude Code' }, { id: 'codex', name: 'Codex' }, { id: 'opencode', name: 'OpenCode' }, { id: 'antigravity', name: 'Antigravity' }, { id: 'zcode', name: 'ZCode' },
    ] } });
  });
  await page.addInitScript(() => { localStorage.setItem('office-tips', 'seen'); localStorage.setItem('office-lite', 'on'); });
  await page.goto('/?layout=cozy');
  await expect(async () => { if (!(await page.locator('#zchat').isVisible())) await page.click('#btn-chat'); await expect(page.locator('#zchat')).toBeVisible({ timeout: 2000 }); }).toPass({ timeout: 120_000 });
  const chat = page.locator('#zchat');
  await chat.locator('.zc-task-btn').click();
  const sheet = chat.locator('.zc-task');
  await sheet.locator('.zc-task-o', { hasText: 'project · OpenCode' }).click();
  await sheet.locator('.zc-model-list').selectOption('custom/my-model');
  await sheet.locator('.zc-task-in').fill('inspect the project');
  await sheet.locator('.zc-task-go').click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ dir: '/project', agent: 'opencode', model: 'custom/my-model', text: 'inspect the project', fresh: true });
  await chat.locator('.zc-to-chip').click();
  await chat.locator('.zc-to-o', { hasText: 'project · ZCode' }).click();
  await expect(chat.locator('.zc-to .zc-model')).toHaveCount(0);
  await chat.locator('.zc-in').fill('review the project');
  await chat.locator('.zc-in').press('Enter');
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toMatchObject({ dir: '/project', agent: 'zcode', text: 'review the project', fresh: true });
  await chat.locator('.zc-to-chip').click();
  await chat.locator('.zc-to-o', { hasText: 'project · Codex' }).click();
  await chat.locator('.zc-to .zc-model-list').selectOption('custom/my-model');
  await chat.locator('.zc-in').fill('check the project');
  await chat.locator('.zc-in').press('Enter');
  await expect.poll(() => sent.length).toBe(3);
  expect(sent[2]).toMatchObject({ agent: 'codex', model: 'custom/my-model', text: 'check the project' });
  for (const [agent, name] of [['antigravity', 'Antigravity'], ['claude', 'Claude Code']]) {
    await chat.locator('.zc-to-chip').click();
    await chat.locator('.zc-to-o', { hasText: 'project · ' + name }).click();
    await chat.locator('.zc-to .zc-model-list').selectOption('custom/my-model');
    await chat.locator('.zc-in').fill('check ' + agent);
    await chat.locator('.zc-in').press('Enter');
    await expect.poll(() => sent.at(-1)?.agent).toBe(agent);
    expect(sent.at(-1)).toMatchObject({ agent, model: 'custom/my-model', text: 'check ' + agent });
  }
});

test('model discovery errors stay visible and retry keeps the prompt and manual model', async ({ page }) => {
  let tries = 0;
  await page.route('**/api/tasks**', (route) => route.fulfill({ json: { ok: true, allowed: true, running: [], sessions: [], projects: [{ dir: '/project', name: 'project' }], agents: [{ id: 'opencode', name: 'OpenCode' }] } }));
  await page.route('**/api/models?**', async (route) => {
    tries++;
    await route.fulfill(tries === 1 ? { status: 502, json: { ok: false, code: 'modelsUnavailable' } } : { json: { ok: true, models: [{ id: 'custom/model', name: 'Custom' }] } });
  });
  await page.addInitScript(() => { localStorage.setItem('office-tips', 'seen'); localStorage.setItem('office-lite', 'on'); });
  await page.goto('/?layout=cozy');
  await expect(async () => { if (!(await page.locator('#zchat').isVisible())) await page.click('#btn-chat'); await expect(page.locator('#zchat')).toBeVisible({ timeout: 2000 }); }).toPass({ timeout: 120000 });
  await page.locator('#zchat .zc-task-btn').click();
  const sheet = page.locator('.zc-task');
  await expect(sheet.locator('.zc-model-status')).toContainText('Could not load');
  await sheet.locator('.zc-task-in').fill('keep this prompt');
  await sheet.locator('.zc-model').fill('manual/model');
  await sheet.locator('.zc-model-retry').click();
  await expect(sheet.locator('.zc-model-list')).toBeVisible();
  await expect(sheet.locator('.zc-task-in')).toHaveValue('keep this prompt');
  await expect(sheet.locator('.zc-model')).toHaveValue('manual/model');
});
