// 模板任务派生（「复制」/「AI 新建」）接线检查
// 运行：node tests/js/gov_task_clone.test.js
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const html = read('index.html');
const ontology = read('js/script-ontology.js');
const governance = read('governance.go');

let failed = 0;
function check(name, cond) {
  if (cond) { console.log('✓ ' + name); } else { failed++; console.error('✗ ' + name); }
}

// 1) 详情页按钮
check('详情页有「复制」按钮', /id="duplicateGovTaskBtn"[^>]*onclick="duplicateGovTask\(\)"/.test(html));
check('详情页有「AI 新建」按钮', /id="aiCloneGovTaskBtn"[^>]*onclick="openGovAiClone\(\)"/.test(html));

// 2) 两个弹窗 + 关键元素
check('存在复制弹窗', /id="govDuplicateModal"/.test(html));
check('复制弹窗有名称输入', /id="govDupNameInput"/.test(html));
check('复制弹窗有确认按钮', /id="govDupConfirmBtn"[^>]*onclick="confirmGovDuplicate\(\)"/.test(html));

check('存在 AI 新建弹窗', /id="govAiCloneModal"/.test(html));
check('AI 新建有「生成问题」按钮', /id="govAiGenQuestionsBtn"[^>]*onclick="govAiCloneGenerateQuestions\(\)"/.test(html));
check('AI 新建有「生成任务」按钮', /id="govAiGenTaskBtn"[^>]*onclick="govAiCloneGenerateTask\(\)"/.test(html));
check('AI 新建有保存按钮', /id="govAiCloneSaveBtn"[^>]*onclick="govAiCloneSave\(\)"/.test(html));
check('AI 新建有问题表单容器', /id="govAiQuestionsForm"/.test(html));
check('AI 新建有代码预览', /id="govAiCloneCode"/.test(html));

// 3) 前端函数齐备
['duplicateGovTask', 'confirmGovDuplicate', 'hideGovDuplicateModal',
 'openGovAiClone', 'closeGovAiClone', 'govAiCloneGenerateQuestions',
 'govAiCloneGenerateTask', 'govAiCloneSave', 'govAiStreamPrompt', 'govExtractJson',
 'govTemplateBrief'].forEach((fn) => {
  check('script-ontology.js 定义了 ' + fn + '()',
    new RegExp('(?:async )?function ' + fn + '\\s*\\(').test(ontology));
});

// 4) 调用的接口与模型协议
check('复制走 /duplicate 接口', /gov\/tasks\/\$\{[^}]*\}\/duplicate/.test(ontology) || /\/duplicate`/.test(ontology));
check('AI 走流式补全端点', /\/api\/v1\/agent\/completion\/stream/.test(ontology));
check('AI 提问要求 JSON 数组', /只输出一个 JSON 数组/.test(ontology));
check('AI 生成要求 JSON 对象', /只输出一个 JSON 对象/.test(ontology));
check('生成结果经 /api/v1/gov/tasks 保存', /fetchWithAuth\(`\$\{API_BASE\}\/api\/v1\/gov\/tasks`, \{[\s\S]{0,200}method: 'POST'/.test(ontology));

// 5) 后端复制路由
check('后端注册 duplicate 子路由', /case "duplicate":/.test(governance));
check('后端实现 handleGovernanceTaskDuplicate', /func handleGovernanceTaskDuplicate\(/.test(governance));
check('复制时重置运行态（状态 idle）', /Status:\s+"idle"/.test(governance));

// 6) 缓存版本已 bump
check('index.html 已 bump script-ontology 版本', /script-ontology\.js\?v=2026091908/.test(html));

if (failed) {
  console.error('\n失败 ' + failed + ' 项');
  process.exit(1);
}
console.log('\n全部通过');
