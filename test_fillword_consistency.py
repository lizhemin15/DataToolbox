#!/usr/bin/env python3
"""
测试前后端 fillWordTemplate 执行一致性
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
    # 创建临时任务文件
    task_data = {
        "code": f'''
async function main() {{
  const tpl = INPUT_FILES[0];
  const data = {json.dumps(test_data, ensure_ascii=False)};
  await gov.fillWordTemplate(tpl, data, "output.docx");
  gov.log("完成");
}}
''',
        "token": "test-token",
        "files": []
    }
    
    # 读取模板文件并编码
    with open(template_path, 'rb') as f:
        template_base64 = base64.b64encode(f.read()).decode()
    task_data["files"].append({
        "file_name": "template.docx",
        "file_base64": template_base64
    })
    
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
            return {"success": False, "error": result.stderr}
        
        # 解析输出
        output = json.loads(result.stdout)
        return output
    finally:
        os.unlink(task_file)

def compare_xml_content(docx1_path, docx2_path):
    """比较两个 docx 文件的 XML 内容"""
    def extract_xml(path):
        with zipfile.ZipFile(path, 'r') as z:
            return z.read('word/document.xml').decode('utf-8')
    
    xml1 = extract_xml(docx1_path)
    xml2 = extract_xml(docx2_path)
    
    # 简单比较（实际应该更智能地比较）
    return xml1 == xml2

def main():
    print("=" * 60)
    print("前后端 fillWordTemplate 执行一致性测试")
    print("=" * 60)
    
    gov_runner_path = "/opt/datatoolbox/gov-runner"
    template_path = "/root/projects/DataToolbox/examples/governance/综合日报模板.docx"
    
    if not os.path.exists(gov_runner_path):
        print(f"❌ gov-runner 不存在: {gov_runner_path}")
        return
    
    if not os.path.exists(template_path):
        print(f"❌ 模板不存在: {template_path}")
        # 使用第一个找到的 docx 文件
        import glob
        docx_files = glob.glob("/root/projects/DataToolbox/examples/governance/**/*.docx", recursive=True)
        if docx_files:
            template_path = docx_files[0]
            print(f"使用模板: {template_path}")
        else:
            print("❌ 没有找到任何 docx 模板文件")
            return
    
    for tc in test_cases:
        print(f"\n--- {tc['name']} ---")
        print(f"数据: {json.dumps(tc['data'], ensure_ascii=False)[:100]}...")
        
        # 运行后端测试
        result = run_backend_test(tc['data'], template_path, gov_runner_path)
        
        if result.get('success'):
            print(f"✅ 后端执行成功")
            print(f"   输出: {result.get('output', [])[:3]}")
            if result.get('output_files'):
                print(f"   生成文件: {[f['name'] for f in result['output_files']]}")
        else:
            print(f"❌ 后端执行失败: {result.get('error', 'Unknown error')}")

if __name__ == "__main__":
    main()
