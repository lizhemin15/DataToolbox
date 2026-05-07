import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../apps/data-ontology/script.js', import.meta.url), 'utf-8');

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
