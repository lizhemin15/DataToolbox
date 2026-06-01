package templates

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// AppTemplate 应用模板定义
type AppTemplate struct {
	ID           string                 `json:"id"`
	Name         string                 `json:"name"`
	Description  string                 `json:"description"`
	Category     string                 `json:"category"`
	Icon         string                 `json:"icon"`
	Tags         []string               `json:"tags"`
	RequiredTables map[string]TableReq  `json:"required_tables"`
	DefaultConfig DefaultConfig         `json:"default_config"`
	Components   []TemplateComponent    `json:"components"`
	Placeholders map[string]Placeholder `json:"placeholders"`
	ChartVariants map[string]ChartVariant `json:"chart_variants,omitempty"`
}

// TableReq 模板所需的数据表要求
type TableReq struct {
	Description      string   `json:"description"`
	RequiredColumns  []string `json:"required_columns"`
	OptionalColumns  []string `json:"optional_columns"`
}

// DefaultConfig 默认配置
type DefaultConfig struct {
	Title           string `json:"title"`
	DesignDirection string `json:"design_direction"`
	PrimaryColor    string `json:"primary_color"`
}

// TemplateComponent 模板中的组件实例
type TemplateComponent struct {
	ComponentID string                 `json:"component_id"`
	Config      map[string]interface{} `json:"config"`
}

// Placeholder 占位符定义
type Placeholder struct {
	Description string `json:"description"`
	AutoFill    string `json:"auto_fill"`
	Template    string `json:"template"`
}

// ChartVariant 图表变体（用于 single-chart 等多选模板）
type ChartVariant struct {
	Description string                 `json:"description"`
	ComponentID string                 `json:"component_id"`
	Config      map[string]interface{} `json:"config"`
}

// Blueprint 从模板生成的应用蓝图
type Blueprint struct {
	Title           string              `json:"title"`
	Slug            string              `json:"slug"`
	Description     string              `json:"description"`
	Icon            string              `json:"icon"`
	DesignDirection string              `json:"design_direction"`
	PrimaryColor    string              `json:"primary_color"`
	Components      []ComponentInst     `json:"components"`
}

// ComponentInst 组件实例
type ComponentInst struct {
	ComponentID string                 `json:"component_id"`
	Config      map[string]interface{} `json:"config"`
}

// templateRegistry 全局模板注册表
var templateRegistry = map[string]*AppTemplate{}

// LoadTemplates 从目录加载所有应用模板
func LoadTemplates(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("读取模板目录失败: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}

		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}

		var tmpl AppTemplate
		if err := json.Unmarshal(data, &tmpl); err != nil {
			continue
		}

		templateRegistry[tmpl.ID] = &tmpl
	}

	return nil
}

// GetTemplate 获取模板定义
func GetTemplate(id string) (*AppTemplate, bool) {
	tmpl, ok := templateRegistry[id]
	return tmpl, ok
}

// ListTemplates 按分类列出所有模板
func ListTemplates() map[string][]*AppTemplate {
	result := map[string][]*AppTemplate{}
	for _, tmpl := range templateRegistry {
		result[tmpl.Category] = append(result[tmpl.Category], tmpl)
	}
	for cat := range result {
		sort.Slice(result[cat], func(i, j int) bool {
			return result[cat][i].Name < result[cat][j].Name
		})
	}
	return result
}

// ListTemplatesFlat 扁平列表（按分类排序）
func ListTemplatesFlat() []*AppTemplate {
	result := make([]*AppTemplate, 0, len(templateRegistry))
	for _, tmpl := range templateRegistry {
		result = append(result, tmpl)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Category != result[j].Category {
			return result[i].Category < result[j].Category
		}
		return result[i].Name < result[j].Name
	})
	return result
}

// Instantiate 从模板实例化蓝图，填充数据库表信息
// databaseID: 数据库ID, tableNameMap: 模板表名→实际表名的映射, variant: 图表变体（可选）
func Instantiate(templateID string, databaseID string, tableNameMap map[string]string, variant string) (*Blueprint, error) {
	tmpl, ok := templateRegistry[templateID]
	if !ok {
		return nil, fmt.Errorf("模板 %s 不存在", templateID)
	}

	// 构建 API URL 前缀
	apiBase := fmt.Sprintf("/api/v1/databases/%s/tables", databaseID)

	// 解析占位符映射
	placeholderValues := map[string]string{}
	for key := range tmpl.Placeholders {
		tableKey := extractTableKey(key) // 从 {{TABLE_API:sales}} 提取 "sales"
		if actualTable, ok := tableNameMap[tableKey]; ok {
			placeholderValues[key] = apiBase + "/" + actualTable
		}
	}

	// 如果没有占位符定义，自动生成
	if len(tmpl.Placeholders) == 0 {
		for tableKey, actualTable := range tableNameMap {
			placeholder := fmt.Sprintf("{{TABLE_API:%s}}", tableKey)
			placeholderValues[placeholder] = apiBase + "/" + actualTable
		}
	}

	// 选择组件列表
	components := tmpl.Components
	if variant != "" && tmpl.ChartVariants != nil {
		if v, ok := tmpl.ChartVariants[variant]; ok {
			components = []TemplateComponent{
				{ComponentID: v.ComponentID, Config: v.Config},
			}
		}
	}

	// 填充占位符
	instantiated := make([]ComponentInst, 0, len(components))
	for _, tc := range components {
		config := make(map[string]interface{})
		for k, v := range tc.Config {
			config[k] = resolvePlaceholders(v, placeholderValues)
		}
		instantiated = append(instantiated, ComponentInst{
			ComponentID: tc.ComponentID,
			Config:      config,
		})
	}

	// 生成 slug
	slug := tmpl.ID
	if len(tableNameMap) > 0 {
		// 用第一个实际表名作为 slug 的一部分
		for _, v := range tableNameMap {
			slug = sanitizeSlug(v) + "-" + tmpl.ID
			break
		}
	}

	return &Blueprint{
		Title:           tmpl.DefaultConfig.Title,
		Slug:            slug,
		Description:     tmpl.Description,
		Icon:            tmpl.Icon,
		DesignDirection: tmpl.DefaultConfig.DesignDirection,
		PrimaryColor:    tmpl.DefaultConfig.PrimaryColor,
		Components:      instantiated,
	}, nil
}

// resolvePlaceholders 递归解析值中的占位符
func resolvePlaceholders(v interface{}, placeholders map[string]string) interface{} {
	switch val := v.(type) {
	case string:
		result := val
		for ph, replacement := range placeholders {
			result = strings.ReplaceAll(result, ph, replacement)
		}
		return result
	case map[string]interface{}:
		result := make(map[string]interface{})
		for k, v2 := range val {
			result[k] = resolvePlaceholders(v2, placeholders)
		}
		return result
	case []interface{}:
		result := make([]interface{}, len(val))
		for i, v2 := range val {
			result[i] = resolvePlaceholders(v2, placeholders)
		}
		return result
	default:
		return v
	}
}

// extractTableKey 从 {{TABLE_API:sales}} 提取 "sales"
func extractTableKey(placeholder string) string {
	start := strings.Index(placeholder, ":")
	end := strings.Index(placeholder, "}}")
	if start < 0 || end < 0 || start >= end {
		return ""
	}
	return placeholder[start+1 : end]
}

// sanitizeSlug 清理 slug 字符串
func sanitizeSlug(s string) string {
	s = strings.ToLower(s)
	s = strings.ReplaceAll(s, " ", "-")
	result := ""
	for _, c := range s {
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' {
			result += string(c)
		}
	}
	return result
}

// ToJSON 将模板转为 JSON（用于 MCP 工具返回）
func (t *AppTemplate) ToJSON() string {
	b, _ := json.MarshalIndent(t, "", "  ")
	return string(b)
}

// ToJSON 将蓝图转为 JSON
func (b *Blueprint) ToJSON() string {
	data, _ := json.MarshalIndent(b, "", "  ")
	return string(data)
}
