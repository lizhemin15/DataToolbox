import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// 前端治理逻辑已拆分为 script-governance.js + script-ontology.js，合并检查
const script = [
  readFileSync(new URL('../js/script-governance.js', import.meta.url), 'utf-8'),
  readFileSync(new URL('../js/script-ontology.js', import.meta.url), 'utf-8'),
].join('\n');

describe('governance persistence hooks', () => {
  test('save payload includes run_mode and execution_mode', () => {
    expect(script).toContain("run_mode: runMode");
    expect(script).toContain("execution_mode: runMode");
  });

  test('run mode is read back from loaded task data', () => {
    expect(script).toContain("currentGovTask.run_mode || currentGovTask.execution_mode || currentGovTask.exec_mode");
    expect(script).toContain("getGovTaskRunMode(currentGovTask)");
  });

  test('execution routes to frontend or backend explicitly', () => {
    expect(script).toContain("if (runMode === 'frontend')");
    expect(script).toContain("await executeGovTaskOnBackend([], '');");
    expect(script).toContain("await executeGovTaskOnBackend(files, inputText);");
  });
});
