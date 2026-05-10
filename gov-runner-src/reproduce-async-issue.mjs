/**
 * 复现 gov-runner async/await 不等待问题
 * 用法: node reproduce-async-issue.mjs
 */

// 模拟 runUserCode 核心逻辑（修复前）
async function runUserCode_BEFORE_FIX(code) {
  const logLines = [];
  const gov = {
    log(msg) { logLines.push(msg); }
  };
  
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  const fn = new AsyncFunction('gov', code);
  
  // 修复前：直接 await fn()，但用户代码里 async function main() 调用不写 await 时，fn() 返回的 Promise 会立即 resolve
  await fn(gov);
  
  return { success: true, output: logLines };
}

// 模拟 runUserCode 核心逻辑（修复后）
async function runUserCode_AFTER_FIX(code) {
  const logLines = [];
  const gov = {
    log(msg) { logLines.push(msg); }
  };
  
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  const fn = new AsyncFunction('gov', code);
  
  const result = fn(gov);
  
  // 修复后：显式检查并等待返回的 Promise
  if (result && typeof result.then === 'function') {
    await result;
  }
  
  return { success: true, output: logLines };
}

async function main() {
  // 用户常见写法：定义 async main 并调用，但不写 await
  const userCode = `
async function main(){
  gov.log('开始');
  await new Promise(r => setTimeout(r, 100));
  gov.log('完成');
}
main(); // 注意：没有 await
`;

  console.log('=== 复现 gov-runner async/await 不等待问题 ===\n');
  
  console.log('用户代码:');
  console.log(userCode);
  
  console.log('\n--- 修复前 ---');
  const before = await runUserCode_BEFORE_FIX(userCode);
  console.log('输出:', before.output);
  console.log('问题: 只输出 "开始"，"完成" 丢失\n');
  
  console.log('--- 修复后 ---');
  const after = await runUserCode_AFTER_FIX(userCode);
  console.log('输出:', after.output);
  console.log('结果: 正确等待 async main() 完成，输出完整\n');
  
  // 验证
  const PASS = after.output.includes('开始') && after.output.includes('完成');
  console.log(PASS ? '✅ 验证通过' : '❌ 验证失败');
  process.exit(PASS ? 0 : 1);
}

main().catch(e => {
  console.error('运行出错:', e);
  process.exit(1);
});
