// 补抓剩余截图（AI 新建生成结果、各功能模块、设置弹窗）
// 用法：NODE_PATH=... node docs/manual/take_screenshots_part2.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.DT_BASE || 'http://127.0.0.1:8080';
const OUT = path.join(__dirname, 'screenshots');
const EX = '/opt/datatoolbox/apps/data-ontology/example_files';
const ALL_TABS = { database: true, governance: true, api: true, ai: true, apps: true, 'screen-editor': true, ontology: true, lineage: true, mcp: true, models: true, quality: true };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', () => {});
  const shot = async (name) => {
    try {
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(OUT, name + '.png') });
      console.log('✓ ' + name);
    } catch (e) { console.log('✗ ' + name + '：' + String(e.message).slice(0, 120)); }
  };
  const tab = async (t, wait = 2000) => {
    const el = await page.$(`.nav-tab[data-tab="${t}"]`);
    if (!el || !(await el.isVisible())) { console.log('– 跳过（未显示）: ' + t); return false; }
    await el.click(); await page.waitForTimeout(wait); return true;
  };

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.fill('input[type="text"], input[name="username"], #username', 'admin');
  await page.fill('input[type="password"]', 'admin1234');
  await page.click('button:has-text("登录")');
  await page.waitForTimeout(2500);

  const originalVisibility = await page.evaluate(async () => (await loadUserSettings()).tabVisibility || null).catch(() => null);
  await page.evaluate(async (vis) => { const s = await loadUserSettings(); s.tabVisibility = vis; await saveUserSettings(s); }, ALL_TABS).catch(() => {});
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // ---- AI 新建：生成结果预览 ----
  try {
    await tab('governance');
    await page.click('text=产品汇总Word生成（套用表格模板）');
    await page.waitForTimeout(1500);
    await page.click('#aiCloneGovTaskBtn');
    await page.waitForTimeout(600);
    await page.click('#govAiGenQuestionsBtn');
    await page.waitForSelector('#govAiCloneStep2', { state: 'visible', timeout: 180000 });
    const ins = await page.$$('#govAiQuestionsForm input');
    const ans = ['两个 Word 一起上传：表格模板 + 各部门产品介绍', '输出 华东区产品汇总.docx；每个产品一张表',
      '省-市-区三级标题，每产品一张表', '不调用 AI', '前端执行', '套模板第一张表样式'];
    for (let i = 0; i < ins.length; i++) await ins[i].fill(ans[i % ans.length]);
    await page.click('#govAiGenTaskBtn');
    await page.waitForSelector('#govAiCloneStep3', { state: 'visible', timeout: 420000 });
    await shot('11-ai-clone-generated');
    await page.evaluate(() => { try { closeGovAiClone(); } catch (e) {} });
    await page.waitForTimeout(600);
  } catch (e) { console.log('AI 生成结果截图失败：' + String(e.message).slice(0, 150)); }

  await tab('api');               await shot('12-api');
  await tab('mcp', 2500);         await shot('13-agent');
  await tab('models', 2500);      await shot('14-models');
  await tab('quality', 3500);     await shot('15-quality');
  await tab('apps', 2500);        await shot('16-apps');
  await tab('screen-editor', 3500); await shot('17-screen-editor');
  await tab('ai', 2500);          await shot('18-ai-assistant');

  // ---- 设置 → LLM 配置（含自动获取模型） ----
  try {
    await page.evaluate(() => showAiSettingsModal());
    await page.waitForTimeout(1200);
    await page.evaluate(() => { const p = document.getElementById('llmConfigPanel'); if (p) p.classList.remove('hidden-panel'); });
    await page.waitForTimeout(500);
    const token = await page.evaluate(() => localStorage.getItem('dataOntologyToken') || '');
    const cfg = await (await page.request.get(BASE + '/api/v1/agent/config', { headers: { Authorization: 'Bearer ' + token } })).json().catch(() => null);
    if (cfg && cfg.config) {
      if (!(await page.inputValue('#aiUrlInput'))) await page.fill('#aiUrlInput', cfg.config.url || '');
      if (!(await page.inputValue('#aiApiKeyInput'))) await page.fill('#aiApiKeyInput', cfg.config.api_key || '');
    }
    await page.click('#fetchAiModelsBtn').catch(() => {});
    await page.waitForTimeout(8000);
    await shot('19-ai-settings');
    await page.evaluate(() => { try { hideAiSettingsModal(); } catch (e) {} });
    await page.waitForTimeout(800);
  } catch (e) { console.log('设置弹窗截图失败：' + String(e.message).slice(0, 150)); }

  // ---- 设置 → 标签页显示 ----
  try {
    await page.evaluate(() => { try { showSettingsModal(); } catch (e) {} });
    await page.waitForTimeout(2000);
    await shot('20-tab-settings');
    await page.evaluate(() => { try { hideSettingsModal(); } catch (e) {} });
  } catch (e) { console.log('标签页设置截图失败：' + String(e.message).slice(0, 150)); }

  // ---- 还原 ----
  if (originalVisibility) {
    await page.evaluate(async (vis) => { const s = await loadUserSettings(); s.tabVisibility = vis; await saveUserSettings(s); }, originalVisibility).catch(() => {});
    console.log('已还原标签页可见性');
  }
  await browser.close();
  console.log('补抓完成');
})().catch((e) => { console.error('ERR', e); process.exit(1); });
