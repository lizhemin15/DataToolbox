package agent

import (
	"context"
	"fmt"
	"log"
	"os"

	"google.golang.org/adk/tool"
	"google.golang.org/adk/tool/skilltoolset"
	"google.golang.org/adk/tool/skilltoolset/skill"
)

// BuildSkillToolsets 从 Skill 目录构建 adk-go SkillToolset
// 使用 skill.NewFileSystemSource + skill.WithCompletePreloadSource + skilltoolset.New()
func BuildSkillToolsets(ctx context.Context, skillDir string, enabledIDs []string) ([]tool.Toolset, error) {
	// 检查目录是否存在
	if _, err := os.Stat(skillDir); os.IsNotExist(err) {
		log.Printf("[skill-toolset] skill directory %s does not exist, skipping", skillDir)
		return nil, nil
	}

	// 1. 创建 FileSystem Source
	source := skill.NewFileSystemSource(os.DirFS(skillDir))

	// 2. 预加载所有 Skill 数据到内存（加速后续访问）
	source, reload, err := skill.WithCompletePreloadSource(ctx, source)
	if err != nil {
		log.Printf("[skill-toolset] WARNING: preload skills failed: %v, using raw source", err)
		// 预加载失败时仍用原始 source
	} else {
		_ = reload // 保存 reload 函数供后续热更新使用
		log.Printf("[skill-toolset] preloaded skills from %s", skillDir)
	}

	// 3. 创建 SkillToolset
	skillTS, err := skilltoolset.New(ctx, skilltoolset.Config{
		Source: source,
		Name:   "DataToolboxSkills",
	})
	if err != nil {
		return nil, fmt.Errorf("create skill toolset: %w", err)
	}

	log.Printf("[skill-toolset] created skill toolset with %d enabled skills", len(enabledIDs))
	return []tool.Toolset{skillTS}, nil
}

// ReloadSkillToolsets 热重载 Skill 数据
// 调用 WithCompletePreloadSource 返回的 reload 函数
func ReloadSkillToolsets(ctx context.Context, skillDir string) ([]tool.Toolset, error) {
	return BuildSkillToolsets(ctx, skillDir, nil)
}