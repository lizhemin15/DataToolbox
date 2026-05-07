import { describe, expect, test } from 'bun:test';
import { runUserCode } from './runner';

const baseCtx = {
  apiBase: 'http://127.0.0.1:8080',
  token: 'test-token',
  databaseId: '',
  dbType: 'sqlite',
  databases: [],
};

describe('gov-runner', () => {
  test('renders showTable output as table marker', async () => {
    const result = await runUserCode(
      `const data = [\n  { id: 1, name: "项目A", status: "进行中" },\n  { id: 2, name: "项目B", status: "已完成" }\n];\ngov.showTable(data);\ngov.log("完成");`,
      baseCtx
    );

    expect(result.success).toBe(true);
    expect(result.output.some((line) => line.startsWith('__TABLE__:'))).toBe(true);
    expect(result.output.includes('完成')).toBe(true);
  });

  test('supports table alias and plain logging', async () => {
    const result = await runUserCode(
      `gov.table([{ a: 1, b: 2 }]);\ngov.log('ok');`,
      baseCtx
    );

    expect(result.success).toBe(true);
    expect(result.output[0]).toContain('__TABLE__');
    expect(result.output.at(-1)).toBe('ok');
  });

  test('returns generated files when user code writes output', async () => {
    const result = await runUserCode(
      `gov.writeJSON('report', { ok: true, items: [1, 2, 3] });\ngov.writeText('note.txt', 'hello');`,
      baseCtx
    );

    expect(result.success).toBe(true);
    expect(result.output_files?.length).toBe(2);
    expect(result.output_files?.[0].name).toBe('report.json');
    expect(result.output_files?.[1].name).toBe('note.txt');
  });

  test('returns a failure when user code throws', async () => {
    const result = await runUserCode(
      `gov.log('before error');\nthrow new Error('boom');`,
      baseCtx
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain('before error');
    expect(result.error).toContain('boom');
  });
});
