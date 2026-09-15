package main

import (
	"fmt"
	"regexp"
	"strings"
)

// ---------------------------------------------------------------------------
// 规则参数（占位符）机制
//
// 规则 SQL 按 Oracle 方言书写，其中的可变部分写成 {{占位符}}，例如：
//
//	SELECT * FROM {{表名}} WHERE {{字段名}} IS NULL
//
// 占位符取值存于规则的 PARAMS（JSON 对象）。执行前先渲染成真实 SQL，
// 再走既有的方言转换与安全校验。缺失参数时给出可读报错，
// 而不是把空壳 SQL 丢给数据库换回一条 -2007 语法错误。
// ---------------------------------------------------------------------------

// qaPlaceholderRe 匹配 {{ 名称 }}（允许中文与空格）
var qaPlaceholderRe = regexp.MustCompile(`\{\{\s*([^{}]+?)\s*\}\}`)

// qaRulePlaceholders 返回 SQL 中出现的占位符名称（去重，保持首次出现顺序）。
func qaRulePlaceholders(sql string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, m := range qaPlaceholderRe.FindAllStringSubmatch(sql, -1) {
		name := strings.TrimSpace(m[1])
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	return out
}

// qaHasPlaceholders 判断 SQL 是否含占位符。
func qaHasPlaceholders(sql string) bool { return len(qaRulePlaceholders(sql)) > 0 }

// qaValidateParamValue 校验参数值：禁止多语句与注释注入。
func qaValidateParamValue(name, v string) error {
	if strings.Contains(v, ";") {
		return fmt.Errorf("参数「%s」不允许包含分号", name)
	}
	if strings.Contains(v, "--") || strings.Contains(v, "/*") || strings.Contains(v, "*/") {
		return fmt.Errorf("参数「%s」不允许包含 SQL 注释符", name)
	}
	if strings.ContainsAny(v, "\r\n") {
		return fmt.Errorf("参数「%s」不允许换行", name)
	}
	return nil
}

// qaValidateRuleParams 校验规则参数与 SQL 占位符是否匹配。
// 返回：缺失的参数名列表、错误（值非法时）。
func qaValidateRuleParams(sql string, params map[string]string) (missing []string, err error) {
	for _, name := range qaRulePlaceholders(sql) {
		v := strings.TrimSpace(params[name])
		if v == "" {
			missing = append(missing, name)
			continue
		}
		if verr := qaValidateParamValue(name, v); verr != nil {
			return missing, verr
		}
	}
	return missing, nil
}

// qaPruneRuleParams 只保留 SQL 里真正用到的参数，避免残留脏数据。
func qaPruneRuleParams(sql string, params map[string]string) map[string]string {
	out := map[string]string{}
	for _, name := range qaRulePlaceholders(sql) {
		if v := strings.TrimSpace(params[name]); v != "" {
			out[name] = v
		}
	}
	return out
}

// qaRenderRuleSQL 用参数替换 SQL 中的占位符；返回渲染后的 SQL 与缺失参数列表。
func qaRenderRuleSQL(sql string, params map[string]string) (string, []string) {
	missing := []string{}
	seen := map[string]bool{}
	out := qaPlaceholderRe.ReplaceAllStringFunc(sql, func(m string) string {
		name := strings.TrimSpace(qaPlaceholderRe.FindStringSubmatch(m)[1])
		v := strings.TrimSpace(params[name])
		if v == "" {
			if !seen[name] {
				seen[name] = true
				missing = append(missing, name)
			}
			return m // 原样保留，交由调用方报错
		}
		return v
	})
	return out, missing
}

// qaPrepareRuleExecutionSQL 准备规则的可执行 SQL：
// 渲染参数占位符 → 安全校验（只允许 SELECT）→ Oracle 方言转换。
// 缺参数或 SQL 非法时返回可读错误，绝不把空壳 SQL 丢给数据库。
func qaPrepareRuleExecutionSQL(rule qaRule, dialect string) (string, error) {
	orig := strings.TrimSpace(rule.SQL)
	label := "规则 " + rule.NM
	if strings.TrimSpace(rule.Name) != "" {
		label += "（" + strings.TrimSpace(rule.Name) + "）"
	}
	rendered, err := qaRenderRuleSQLErr(orig, rule.Params, label)
	if err != nil {
		return "", err
	}
	safeSQL, err := sanitizeSQLForQA(rendered)
	if err != nil {
		return "", err
	}
	return convertOracleSQLForDialect(safeSQL, dialect), nil
}

// qaRenderRuleSQLErr 渲染并返回可读错误（缺失参数时）。
func qaRenderRuleSQLErr(sql string, params map[string]string, ruleName string) (string, error) {
	rendered, missing := qaRenderRuleSQL(sql, params)
	if len(missing) > 0 {
		label := ruleName
		if strings.TrimSpace(label) == "" {
			label = "规则"
		}
		return "", fmt.Errorf("%s 参数未配置：%s", label, strings.Join(func() []string {
			quoted := make([]string, 0, len(missing))
			for _, m := range missing {
				quoted = append(quoted, "{{"+m+"}}")
			}
			return quoted
		}(), "、"))
	}
	return rendered, nil
}
