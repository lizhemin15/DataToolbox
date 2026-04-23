#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
修复 Word 文档中的二级标题编号问题
将所有二级标题按照正确顺序编号：（一）（二）（三）（四）（五）
"""

from docx import Document
import re
import copy

def fix_heading_numbers(file_path):
    """修复文档中的二级标题编号"""
    doc = Document(file_path)

    # 正确的编号顺序
    correct_numbers = ['（一）', '（二）', '（三）', '（四）', '（五）']

    # 记录修改
    changes = []

    section_index = 0  # 当前区域索引 (0-4)
    in_section = False  # 是否在某个一级标题内

    for para in doc.paragraphs:
        text = para.text.strip()

        # 检查是否是一级标题
        if text.startswith('一、') or text.startswith('二、'):
            section_index = 0  # 重置区域索引
            in_section = True
            continue

        # 检查是否是二级标题（以编号开头且包含"地区"）
        match = re.match(r'^[（(][一二三四五六七八九十]+[）)]', text)
        if match and '地区' in text:
            old_text = text
            # 提取地区名称部分
            region_text = re.sub(r'^[（(][一二三四五六七八九十]+[）)]', '', text)

            # 获取正确的编号
            if section_index < len(correct_numbers):
                correct_number = correct_numbers[section_index]
                new_text = f"{correct_number}{region_text}"

                # 更新段落文本
                para.text = new_text

                changes.append({
                    'old': old_text,
                    'new': new_text
                })

                section_index += 1

    # 保存文档
    doc.save(file_path)

    return changes

def main():
    # 要处理的文件列表
    files = [
        '19990101_国际新闻与运输情况通报_模拟数据.docx',
        '19990102_国际新闻与运输情况通报_模拟数据.docx',
        '19990103_国际新闻与运输情况通报_模拟数据.docx'
    ]

    for file_path in files:
        print(f"\n处理文件: {file_path}")
        print("=" * 60)

        try:
            changes = fix_heading_numbers(file_path)

            if changes:
                print(f"成功修复 {len(changes)} 个标题编号:")
                for change in changes:
                    print(f"  原标题: {change['old']}")
                    print(f"  新标题: {change['new']}")
                    print()
            else:
                print("未发现需要修复的标题")

        except Exception as e:
            print(f"处理失败: {str(e)}")

if __name__ == '__main__':
    main()