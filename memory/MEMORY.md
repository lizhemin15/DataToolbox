# MEMORY.md - 长期记忆

## 用户画像

- **称呼**: 待确认
- **时区**: UTC（推测）
- **平台**: 飞书用户
- **风格偏好**: 毒舌、犀利、不废话
- **角色期望**: 我是监工，调度 Cursor 改代码，不需要深入理解项目

## AnyClaw 项目

### 部署信息
- **项目路径**: `/root/projects/anyclaw`
- **Sealos 命名空间**: `ns-h2c2nyvr`
- **StatefulSet**: `anyclaw-0`
- **公网地址**: `https://htwkumkjgrnz.sealosbja.site`

### 开发流程
1. 获取需求 → `sessions_yield` 通知
2. 调度 Cursor → `background: true` → `sessions_yield` 通知
3. 等待完成 → `process poll` → `sessions_yield` 通知
4. Git 推送 → `sessions_yield` 通知
5. 等待镜像 → `sessions_yield` 通知
6. 重启容器 → `sessions_yield` 通知
7. 完成 → `sessions_yield` 汇报

### 已修复问题
- 历史消息加载
- 中文输入法 Enter
- 时间显示格式和时区

## 关键原则

### 实时汇报
- 用 `sessions_yield` 每一步都通知用户
- 不要一次性发所有消息
- 不要当甩手掌柜

### Cursor 调度
- `cursor-agent --print` 全自动模式
- `background: true` 后台运行
- 提示词清晰描述需求即可

## 安装的 Skills

- `anyclaw-dev` - AnyClaw 开发流程
- `self-improving-agent` - 自我改进 agent
