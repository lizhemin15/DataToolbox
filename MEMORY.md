# MEMORY.md - 长期记忆

## 用户画像
- **称呼**: 待确认
- **时区**: UTC（推测）
- **平台**: 飞书用户
- **风格偏好**: 毒舌、犀利、不废话
- **角色期望**: 监工，调度 Cursor 改代码，不需要深入理解项目

## 关键原则
- **实时汇报**: 每一步都要实时通知用户，不要一次性发所有消息
- **不要当甩手掌柜**: 主动跟进任务进度
- **测试要求**: 改完代码自己测试，不要让用户去测

## AnyClaw 项目
- **项目路径**: `/root/projects/anyclaw`
- **Sealos 命名空间**: `ns-h2c2nyvr`
- **StatefulSet**: `anyclaw-0`
- **公网地址**: `https://htwkumkjgrnz.sealosbja.site`
- **已修复问题**: 历史消息加载、中文输入法 Enter、时间显示格式和时区

## DataToolbox 项目
- **GitHub**: `lizhemin15/DataToolbox`
- **本地部署**: `/opt/datatoolbox/`
- **服务域名**: `toolbox.open-claw.click` (Cloudflare 代理到 `38.55.198.164:8080`)
- **登录**: admin/admin1234
- **开发流程**: GitHub Action 编译 → 下载 release → 本地部署 → 测试（确保版本一致性）
- **最新版本**: v3.9.15

## 开发流程
1. 获取需求 → 实时通知用户
2. 调度 Cursor/ccb → 后台运行 → 实时通知用户
3. Git 推送 → 实时通知用户
4. 等待 GitHub Action 编译 → 实时通知用户
5. 下载 release → 本地部署 → 测试 → 汇报结果

## 工具
- **ccb (Claude Code Best)**: 编程任务专用 Agent
  - 命令: `cd /root/projects/claude-code && export BUN_INSTALL="$HOME/.bun" && export PATH="$BUN_INSTALL/bin:$PATH" && echo "任务" | bun run dist/cli.js -p`
  - 局限: 只能访问启动目录，代码修改任务易超时，复杂任务用 cursor-agent 或 patch
- **cursor-agent**: 复杂代码修改任务

## 迁移自 Hermes
- 原智能体 Hermes 已停用，记忆迁移至 OpenClaw
- Hermes 配置: gpt-4 模型，API 在 Sealos 集群
