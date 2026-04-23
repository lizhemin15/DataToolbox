#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""检查 Word 文档的结构"""

from docx import Document

def inspect_document(file_path):
    """检查文档结构"""
    doc = Document(file_path)

    print(f"\n检查文件: {file_path}")
    print("=" * 80)

    for i, para in enumerate(doc.paragraphs):
        text = para.text.strip()
        if text:
            style = para.style.name
            # 只显示标题和包含"地区"的段落
            if 'Heading' in style or '地区' in text or '国际新闻' in text or '运输保障' in text:
                print(f"[{i:3d}] Style: {style:20s} | Text: {text[:60]}")

if __name__ == '__main__':
    file_path = '19990101_国际新闻与运输情况通报_模拟数据.docx'
    inspect_document(file_path)
