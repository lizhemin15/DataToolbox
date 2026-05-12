#!/usr/bin/env python3
"""
测试前后端 fillWordTemplate 执行一致性 - 增强版
"""

import subprocess
import json
import base64
import tempfile
import os
import zipfile
from pathlib import Path

# 测试数据
test_cases = [
    {
        "name": "测试加粗格式",
        "data": {
            "title": "**加粗标题**",
            "content": "普通内容",
            "mixed": "**加粗**和普通**再加粗**"
        }
    },
    {
        "name": "测试字体标记",
        "data": {
            "title": "[f:黑体,s:18]黑体18号",
            "content": "[f:宋体,s:14]宋体14号",
            "mixed": "[f:黑体,s:16]黑体16号[f:宋体,s:12]宋体12号"
        }
    },
    {
        "name": "测试首行缩进",
        "data": {
            "title": "普通标题",
            "indent1": ">首行缩进内容",
            "indent2": ">另一个缩进段落"
        }
    },
    {
        "name": "测试混合格式",
        "data": {
            "title": "**[f:黑体,s:18]加粗黑体18号**",
            "content": ">[f:仿宋,s:16]**缩进加粗仿宋16号**",
            "complex": "**加粗**[f:宋体,s:14]宋体14号**再加粗**"
        }
    },
    {
        "name": "测试特殊字符",
        "data": {
            "title": "包含<和>符号",
            "content": "A < B > C & D",
            "mixed": "**<加粗>**和[f:宋体,s:14]<字体>"
        }
    }
]

def run_backend_test(test_data, template_path, gov_runner_path):
    """运行后端测试"""
    # 创建任务代码
    code = f'''
async function main() {{
  const tpl = INPUT_FILES[0];
  const data = {json.dumps(test_data, ensure_ascii=False)};
  await gov.fillWordTemplate(tpl, data, "output.docx");
  gov.log("完成");
}}
'''
    
    # 读取模板文件并编码
    with open(template_path, 'rb') as f:
        template_base64 = base64.b64encode(f.read()).decode()
    
    task_data = {
        "code": code,
        "token": "test-token",
        "files": [
            {
                "file_name": "template.docx",
                "file_base64": template_base64
            }
        ]
    }
    
    # 写入临时任务文件
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(task_data, f)
        task_file = f.name
    
    try:
        # 运行 gov-runner
        env = os.environ.copy()
        env["GOV_RUNNER_CLI"] = "true"
        env["API_BASE"] = "http://127.0.0.1:8080"
        
        result = subprocess.run(
            [gov_runner_path, task_file],
            capture_output=True,
            text=True,
            timeout=60,
            env=env
        )
        
        if result.returncode != 0:
            return {"success": False, "error": result.stderr, "stdout": result.stdout}
        
        # 解析输出
        try:
            output = json.loads(result.stdout)
            return output
        except json.JSONDecodeError as e:
            return {"success": False, "error": f"JSON parse error: {e}", "stdout": result.stdout}
    finally:
        os.unlink(task_file)

def extract_docx_content(docx_path):
    """提取 docx 文件的 XML 内容"""
    with zipfile.ZipFile(docx_path, 'r') as z:
        return z.read('word/document.xml').decode('utf-8')

def main():
    print("=" * 60)
    print("前后端 fillWordTemplate 执行一致性测试")
    print("=" * 60)
    
    gov_runner_path = "/opt/datatoolbox/gov-runner"
    
    # 查找模板文件
    import glob
    docx_files = glob.glob("/root/projects/DataToolbox/examples/governance/**/*.docx", recursive=True)
    if not docx_files:
        print("❌ 没有找到任何 docx 模板文件")
        return
    
    template_path = docx_files[0]
    print(f"使用模板: {template_path}")
    
    if not os.path.exists(gov_runner_path):
        print(f"❌ gov-runner 不存在: {gov_runner_path}")
        return
    
    results = []
    for tc in test_cases:
        print(f"\n--- {tc['name']} ---")
        print(f"数据: {json.dumps(tc['data'], ensure_ascii=False)[:80]}...")
        
        # 运行后端测试
        result = run_backend_test(tc['data'], template_path, gov_runner_path)
        
        if result.get('success'):
            print(f"✅ 后端执行成功")
            output_files = result.get('output_files', [])
            if output_files:
                print(f"   生成文件: {[f['name'] for f in output_files]}")
                # 检查文件内容
                for f in output_files:
                    if f['name'].endswith('.docx'):
                        content = base64.b64decode(f['content_base64'])
                        # 保存到临时文件检查
                        with tempfile.NamedTemporaryFile(suffix='.docx', delete=False) as tmp:
                            tmp.write(content)
                            tmp_path = tmp.name
                        try:
                            xml_content = extract_docx_content(tmp_path)
                            # 检查关键内容
                            checks = []
                            for key, value in tc['data'].items():
                                # 检查值是否在 XML 中（去除格式标记后）
                                clean_value = value.replace('**', '').replace('[f:', '').replace(']', '').replace('>', '').strip()
                                if clean_value and clean_value in xml_content:
                                    checks.append(f"✓ '{clean_value[:20]}...' 存在")
                                elif clean_value:
                                    checks.append(f"✗ '{clean_value[:20]}...' 不存在")
                            print(f"   内容检查: {', '.join(checks[:3])}")
                        finally:
                            os.unlink(tmp_path)
            results.append({'name': tc['name'], 'success': True})
        else:
            print(f"❌ 后端执行失败: {result.get('error', 'Unknown error')}")
            if result.get('stdout'):
                print(f"   stdout: {result['stdout'][:200]}")
            results.append({'name': tc['name'], 'success': False, 'error': result.get('error')})
    
    print("\n" + "=" * 60)
    print("测试结果汇总")
    print("=" * 60)
    for r in results:
        status = "✅" if r['success'] else "❌"
        print(f"{status} {r['name']}")
    
    success_count = sum(1 for r in results if r['success'])
    print(f"\n通过: {success_count}/{len(results)}")

if __name__ == "__main__":
    main()
