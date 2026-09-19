// 抓取《数据工具箱使用说明书》所需界面截图
// 用法：NODE_PATH=/root/.hermes/hermes-agent-old/node_modules node docs/manual/take_screenshots.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.DT_BASE || 'http://127.0.0.1:8080';
const OUT = path.join(__dirname, 'screenshots');
const EX = '/opt/datatoolbox/apps/data-ontology/example_files';
const ALL_TABS = { database: true, governance: true, api: true, ai: true, apps: true, 'screen-editor': true, ontology: true, lineage: true, mcp: true, models: true, quality: true };

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', () => {});
  const shot = async (name) => {
    try {
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, name + '.png') });
      console.log('✓ ' + name);
    } catch (e) { console.log('✗ ' + name + '：' + e.message); }
  };
  const tab = async (t, wait = 1500) => {
    const el = await page.$(`.nav-tab[data-tab="${t}"]`);
    if (!el || !(await el.isVisible())) { console.log('– 跳过（标签页未显示）: ' + t); return false; }
    await el.click();
    await page.waitForTimeout(wait);
    return true;
  };
  const login = async () => {
    await page.fill('input[type="text"], input[name="username"], #username', 'admin');
    await page.fill('input[type="password"]', 'admin1234');
    await page.click('button:has-text("登录")');
    await page.waitForTimeout(2500);
  };

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await shot('01-login');
  await login();

  // 记住原始标签页可见性，临时全开以便截图
  const originalVisibility = await page.evaluate(async () => {
    const s = await loadUserSettings();
    return s.tabVisibility || null;
  }).catch(() => null);
  await page.evaluate(async (vis) => {
    const s = await loadUserSettings();
    s.tabVisibility = vis;
    await saveUserSettings(s);
  }, ALL_TABS).catch(() => {});
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  await tab('database');         await shot('02-database');
  await tab('ontology', 2500);   await shot('03-ontology');
  await tab('lineage', 2500);    await shot('04-lineage');
  await tab('governance');       await page.waitForTimeout(1000); await shot('05-governance-tasks');

  // 任务详情
  if (await page.$('text=产品汇总Word生成（套用表格模板）')) {
    await page.click('text=产品汇总Word生成（套用表格模板）');
    await page.waitForTimeout(1500);
    await shot('06-gov-task-detail');

    await page.setInputFiles('#govFileInput', [EX + '/表格模板.docx', EX + '/纯文本产品介绍.docx']);
    await page.waitForTimeout(800);
    await shot('07-gov-input-files');
    const dl = page.waitForEvent('download', { timeout: 120000 }).catch(() => null);
    await page.click('#runGovTaskBtn');
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(2000);
      const t = await page.evaluate(() => (document.getElementById('govTaskOutput') || {}).innerText || '');
      if (/已生成/.test(t)) break;
    }
    await page.waitForTimeout(1200);
    await shot('08-gov-run-output');
    const d = await dl;
    if (d) { await d.saveAs('/tmp/manual-output.docx'); console.log('✓ 输出文件 → /tmp/manual-output.docx'); }

    // AI 新建向导
    await page.click('text=产品汇总Word生成（套用表格模板）').catch(() => {});
    await page.waitForTimeout(1200);
    if (await page.$('#aiCloneGovTaskBtn')) {
      await page.click('#aiCloneGovTaskBtn');
      await page.waitForTimeout(600);
      await shot('09-ai-clone-step1');
      await page.click('#govAiGenQuestionsBtn');
      try {
        await page.waitForSelector('#govAiCloneStep2', { state: 'visible', timeout: 180000 });
        const ins = await page.$$('#govAiQuestionsForm input');
        const ans = ['两个 Word 一起上传：表格模板 + 各部门产品介绍', '输出 华东区产品汇总.docx；每个产品一张表',
          '省-市-区三级标题，每产品一张表', '不调用 AI', '前端执行', '套模板第一张表样式'];
        for (let i = 0; i < ins.length; i++) await ins[i].fill(ans[i % ans.length]);
        await shot('10-ai-clone-questions');
        await page.click('#govAiGenTaskBtn');
        await page.waitForSelector('#govAiCloneStep3', { state: 'visible', timeout: 420000 });
        await shot('11-ai-clone-generated');
        await page.evaluate(() => closeGovAiClone()).catch(() => {});
      } catch (e) { console.log('AI 向导截图跳过：' + String(e.message).slice(0, 120)); }
    }
  }
  await page.waitForTimeout(800);

  await tab('api');      await shot('12-api');
  await tab('mcp', 2000);     await shot('13-agent');
  await tab('models', 2000);  await shot('14-models');
  await tab('quality', 3000); await shot('15-quality');
  await tab('apps', 2000);    await shot('16-apps');
  await tab('screen-editor', 2500); await shot('17-screen-editor');
  await tab('ai', 2000);      await shot('18-ai-assistant');

  // 设置弹窗（AI 配置 + 自动获取模型）
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
    await page.waitForTimeout(7000);
    await shot('19-ai-settings');
    await page.evaluate(() => hideAiSettingsModal && hideAiSettingsModal()).catch(() => {});
  } catch (e) { console.log('设置弹窗截图跳过：' + String(e.message).slice(0, 120)); }

  // 标签页设置弹窗
  try {
    await page.evaluate(() => showSettingsModal && showSettingsModal());
    await page.waitForTimeout(1800);
    await shot('20-tab-settings');
    await page.evaluate(() => hideSettingsModal && hideSettingsModal()).catch(() => {});
  } catch (e) { console.log('标签页设置截图跳过：' + String(e.message).slice(0, 120)); }

  // 还原原标签页可见性
  if (originalVisibility) {
    await page.evaluate(async (vis) => {
      const s = await loadUserSettings();
      s.tabVisibility = vis;
      await saveUserSettings(s);
    }, originalVisibility).catch(() => {});
    console.log('已还原标签页可见性');
  }

  await browser.close();
  console.log('全部截图完成 →', OUT);
}

main().catch((e) => { console.error('ERR', e); process.exit(1); });
