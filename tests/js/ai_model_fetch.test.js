// 智能助手「API 配置」里模型名自动获取 的接线检查
// 运行：node tests/js/ai_model_fetch.test.js
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const html = read('index.html');
const agentJs = read('js/script-agent.js');
const routes = read('routes_v1.go');
const handler = read('ai_models_available.go');

let failed = 0;
function check(name, cond) {
  if (cond) { console.log('✓ ' + name); } else { failed++; console.error('✗ ' + name); }
}

// 前端 UI
check('模型名称输入框绑定 datalist', /id="aiModelInput"[^>]*list="aiModelOptions"/.test(html));
check('存在模型候选 datalist', /<datalist id="aiModelOptions">/.test(html));
check('存在「自动获取模型列表」按钮', /id="fetchAiModelsBtn"[^>]*onclick="fetchAiModels\(\)"/.test(html));
check('向量模型也支持自动获取', /id="aiEmbModel"[^>]*list="aiEmbModelOptions"/.test(html) && /fetchAiModels\('embedding', this\)/.test(html));
check('script-agent.js 已 bump 缓存版本', /script-agent\.js\?v=2026091910/.test(html));

// 前端逻辑
check('定义了 fetchAiModels()', /async function fetchAiModels\(kind, btnEl\)/.test(agentJs));
check('调用 /api/v1/agent/models/available', /\/api\/v1\/agent\/models\/available/.test(agentJs));
check('把结果写入 datalist（下拉可选、仍可手输）', /datalist\.innerHTML = models\.map/.test(agentJs) && /<input type="text" id="aiModelInput"/.test(html));
check('失败时有可见提示', /获取模型列表失败：/.test(agentJs));

// 后端
check('注册路由 /api/v1/agent/models/available', /mux\.HandleFunc\("\/api\/v1\/agent\/models\/available", handleAIModelsAvailable\)/.test(routes));
check('实现 handleAIModelsAvailable', /func handleAIModelsAvailable\(/.test(handler));
check('兼容 /chat/completions 与 /embeddings 推导', /\/chat\/completions/.test(handler) && /\/embeddings/.test(handler));
check('兼容多种上游响应形状', /"data", "models", "result", "items"/.test(handler));

if (failed) {
  console.error('\n失败 ' + failed + ' 项');
  process.exit(1);
}
console.log('\n全部通过');
