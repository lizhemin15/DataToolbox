/**
 * 数据治理任务执行器
 * 支持两种模式：
 * 1. HTTP 服务模式：监听端口，接收 HTTP 请求
 * 2. 命令行模式：直接执行任务
 */

import { runUserCode, type GovContext, type FileLike } from './runner';

const PORT = parseInt(process.env.GOV_RUNNER_PORT || '3100');
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8080';

// ==================== 文件类型判断 ====================

const TEXT_EXTENSIONS = ['.txt', '.csv', '.json', '.xml', '.html', '.css', '.js', '.ts', '.md', '.yaml', '.yml', '.log', '.sql', '.py', '.sh', '.bat', '.ini', '.conf', '.env'];

function isTextFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return TEXT_EXTENSIONS.some(ext => lower.endsWith(ext));
}

// ==================== 文件包装器 ====================

class BufferFile implements FileLike {
  name: string;
  size: number;
  content: string; // 文本内容（仅用于纯文本输入模式）
  private buffer: Buffer;

  constructor(name: string, buffer: Buffer, content?: string) {
    this.name = name;
    this.size = buffer.length;
    this.buffer = buffer;
    // 仅在显式传入 content 时使用（如纯文本虚拟文件），
    // 不要对二进制文件（.docx/.xlsx 等）调用 buffer.toString('utf-8')，
    // 否则会产生乱码，导致脚本误用 file.content 跳过 readWord 解析
    if (content !== undefined) {
      this.content = content;
    } else if (isTextFile(name)) {
      this.content = buffer.toString('utf-8');
    } else {
      this.content = '';
    }
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.buffer.buffer.slice(
      this.buffer.byteOffset, 
      this.buffer.byteOffset + this.buffer.byteLength
    );
  }

  async text(): Promise<string> {
    return this.buffer.toString('utf-8');
  }
}

// ==================== HTTP 服务模式 ====================

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  // 健康检查
  if (url.pathname === '/health') {
    return Response.json({ status: 'ok', timestamp: new Date().toISOString() });
  }

  // 执行任务
  if (url.pathname === '/run' && req.method === 'POST') {
    try {
      const contentType = req.headers.get('content-type') || '';
      
      let code: string;
      let ctx: GovContext;
      let inputFile: FileLike | null = null;
      let inputText = '';

      if (contentType.includes('multipart/form-data')) {
        // multipart 上传
        const formData = await req.formData();
        code = formData.get('code') as string;
        const token = formData.get('token') as string;
        const databaseId = formData.get('database_id') as string;
        const dbType = formData.get('db_type') as string || '';
        const databasesJson = formData.get('databases') as string || '[]';
        inputText = (formData.get('input_text') as string) || '';
        
        const file = formData.get('file');
        if (file && file instanceof File) {
          const buffer = Buffer.from(await file.arrayBuffer());
          inputFile = new BufferFile(file.name, buffer);
        }

        // 解析 currentGovTask
        let currentGovTask: any = null;
        const currentGovTaskJson = formData.get('current_gov_task') as string;
        if (currentGovTaskJson) {
          try {
            currentGovTask = JSON.parse(currentGovTaskJson);
          } catch (e) {
            // ignore parse error
          }
        }

        ctx = {
          apiBase: API_BASE,
          token,
          databaseId,
          dbType,
          databases: JSON.parse(databasesJson),
        };
      } else {
        // JSON 请求
        const body = await req.json();
        code = body.code;
        
        // 解析 currentGovTask
        const currentGovTask = body.current_gov_task || null;
        
        ctx = {
          apiBase: API_BASE,
          token: body.token,
          databaseId: body.database_id,
          dbType: body.db_type || '',
          databases: body.databases || [],
        };
        inputText = body.input_text || '';
        
        // base64 文件
        if (body.file_base64 && body.file_name) {
          const buffer = Buffer.from(body.file_base64, 'base64');
          inputFile = new BufferFile(body.file_name, buffer);
        }
      }

      if (!code) {
        return Response.json({ success: false, error: '缺少代码' }, { status: 400 });
      }

      // 执行
      const result = await runUserCode(code, ctx, { inputFile, inputText, currentGovTask });

      return Response.json({
        success: result.success,
        output: result.output,
        error: result.error,
        output_files: result.output_files,
      }, {
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    } catch (error: any) {
      return Response.json({ 
        success: false, 
        error: error.message || '执行失败' 
      }, { 
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  return Response.json({ error: 'Not Found' }, { status: 404 });
}

// ==================== 命令行模式 ====================

async function runFromCLI() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('用法: gov-runner <task.json>');
    console.error('  task.json 包含: code, token, database_id, db_type, databases, input_text, file_base64?, file_name?');
    process.exit(1);
  }

  const taskFile = args[0];
  const task = JSON.parse(await Bun.file(taskFile).text());

  const ctx: GovContext = {
    apiBase: task.api_base || API_BASE,
    token: task.token,
    databaseId: task.database_id,
    dbType: task.db_type || '',
    databases: task.databases || [],
  };

  let inputFile: FileLike | null = null;
  let inputFiles: FileLike[] | null = null;
  if (task.files && Array.isArray(task.files) && task.files.length > 0) {
    inputFiles = task.files.map((f: { file_name: string; file_base64: string }) =>
      new BufferFile(f.file_name, Buffer.from(f.file_base64, 'base64'))
    );
  } else if (task.file_base64 && task.file_name) {
    const buffer = Buffer.from(task.file_base64, 'base64');
    inputFile = new BufferFile(task.file_name, buffer);
  }

  const result = await runUserCode(task.code, ctx, {
    inputFile,
    inputFiles,
    inputText: task.input_text || '',
    currentGovTask: task.current_gov_task || null,
  });

  // 输出 JSON 结果（Go 服务解析）
  console.log(JSON.stringify(result, null, 2));
  // 始终以 0 退出，便于 Go 的 cmd.Output 捕获 stdout；失败见 JSON 的 success/error/output
  process.exit(0);
}

// ==================== 入口 ====================

async function main() {
  if (process.env.GOV_RUNNER_CLI === 'true' || process.argv.length > 2) {
    try {
      await runFromCLI();
    } catch (err: any) {
      console.log(JSON.stringify({ success: false, output: [], error: err.message || String(err) }));
      process.exit(0);
    }
  } else {
    // HTTP 服务模式
    console.log(`gov-runner HTTP 服务启动，端口 ${PORT}`);
    console.log(`API_BASE: ${API_BASE}`);
    
    Bun.serve({
      port: PORT,
      fetch: handleRequest,
    });
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
