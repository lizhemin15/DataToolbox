# 《数据工具箱使用说明书》维护说明

本目录用于生成随安装包一起发布的 Word 版使用说明书（`docs/使用说明书.docx`）。

## 产出物

| 文件 | 说明 |
| --- | --- |
| `docs/使用说明书.docx` | 正式说明书，**公文格式排版**，随安装包发布 |
| `docs/manual/build_manual.py` | 说明书正文与排版生成脚本（python-docx） |
| `docs/manual/take_screenshots.js` | 抓取界面截图（Playwright，需要本地服务在跑） |
| `docs/manual/screenshots/*.png` | 界面截图（已压缩到 1600px 宽，随仓库提交） |

## 排版约定（公文格式）

- 页边距：上 37mm、下 35mm、左 28mm、右 26mm；A4 纵向。
- 正文：三号仿宋_GB2312，行距固定值 28 磅，首行缩进 2 字符。
- 标题：二号方正小标宋简体；一级标题三号黑体，二级标题三号楷体_GB2312 加粗，三级标题三号仿宋加粗。
- 页脚：四号宋体居中页码；目录为静态目录（带点线引导与页码）。

## 日常更新流程（功能有变时）

1. **改文字**：编辑 `build_manual.py` 中对应章节的函数（`build_intro` / `build_install` / `build_login_and_nav` / `build_database` / `build_governance` / `build_other_modules` / `build_faq_and_appendix`）。
2. **改截图**（界面变了才需要）：
   ```bash
   # 先启动服务（默认 http://127.0.0.1:8080）
   NODE_PATH=<playwright 模块路径> node docs/manual/take_screenshots.js
   NODE_PATH=<playwright 模块路径> node docs/manual/take_screenshots_part2.js
   ```
   新截图会自动落到 `screenshots/`，建议压缩到 1600px 宽（可用 Pillow）。
3. **重新生成**：
   ```bash
   python3 docs/manual/build_manual.py
   ```
   脚本会自动做两遍排版：先用一次转换测出各章页码，再把页码写进目录。若本机没有 `soffice`，目录将不含页码。
4. **提交**：把 `docs/使用说明书.docx` 与脚本改动一起提交。发布流水线会把该文件放进安装包根目录。

## CI 行为

- `Build Dev`：会用脚本重新生成一次 docx，若与仓库中的版本不一致会给出 warning（提示说明书可能过期）。
- `Build and Release`：把 `docs/使用说明书.docx` 复制进各平台安装包根目录；若文件缺失会尝试现场重建。

## 注意事项

- 截图脚本会临时把当前用户的「标签页显示」全部打开（以便拍到默认隐藏的模块），结束后会还原；请勿在正式环境的高峰期运行。
- 截图里的账号、数据均为演示数据，不要放入真实敏感数据。
- 版本号在封面显示：可用环境变量覆盖，例如 `DT_MANUAL_VERSION=v1.2.3 python3 docs/manual/build_manual.py`。
