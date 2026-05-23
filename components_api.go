package main

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/YOUR_USERNAME/DataToolbox/components"
)

// handleListComponents GET /api/v1/components — 返回可用预制组件列表
func handleListComponents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	category := r.URL.Query().Get("category")
	allComps := components.ListComponents()

	if category != "" {
		if catComps, ok := allComps[category]; ok {
			allComps = map[string][]*components.ComponentDef{category: catComps}
		} else {
			allComps = map[string][]*components.ComponentDef{}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(allComps)
}

// previewAppRequest 预览请求
type previewAppRequest struct {
	Title           string                          `json:"title"`
	Slug            string                          `json:"slug"`
	Description     string                          `json:"description"`
	Icon            string                          `json:"icon"`
	DesignDirection string                          `json:"design_direction"`
	PrimaryColor    string                          `json:"primary_color"`
	Components      []components.ComponentInstance  `json:"components"`
}

// handlePreviewApp POST /api/v1/components/preview — 生成预览 HTML
func handlePreviewApp(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req previewAppRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.Components) == 0 {
		http.Error(w, "components list is empty", http.StatusBadRequest)
		return
	}

	// 验证组件 ID + 填充默认值
	for i, c := range req.Components {
		def, ok := components.GetComponentDef(c.GetID())
		if !ok {
			http.Error(w, fmt.Sprintf("component %q not found", c.GetID()), http.StatusBadRequest)
			return
		}
		if c.Config == nil {
			c.Config = map[string]interface{}{}
		}
		for k, schema := range def.ConfigSchema {
			if _, exists := c.Config[k]; !exists && schema.Default != nil {
				c.Config[k] = schema.Default
			}
		}
		req.Components[i] = c
	}

	blueprint := components.AppBlueprint{
		Title:           req.Title,
		Slug:            req.Slug,
		Description:     req.Description,
		Icon:            req.Icon,
		DesignDirection: req.DesignDirection,
		PrimaryColor:    req.PrimaryColor,
		Components:      req.Components,
	}

	primaryColor := req.PrimaryColor
	if primaryColor == "" {
		primaryColor = "#4F46E5"
	}

	html := components.GeneratePreviewHTML(blueprint, primaryColor)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(html))
}
