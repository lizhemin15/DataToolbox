package main

import (
	"testing"
)

// TestUserHasToken 测试 userHasToken 辅助函数
func TestUserHasToken(t *testing.T) {
	tests := []struct {
		name      string
		user      *User
		token     string
		wantValid bool
	}{
		{
			name: "token in Tokens list",
			user: &User{
				Username: "testuser",
				Tokens:   []string{"token1", "token2", "token3"},
			},
			token:     "token2",
			wantValid: true,
		},
		{
			name: "token not in Tokens list",
			user: &User{
				Username: "testuser",
				Tokens:   []string{"token1", "token2"},
			},
			token:     "token3",
			wantValid: false,
		},
		{
			name: "old Token field (backward compatibility)",
			user: &User{
				Username: "testuser",
				Token:    "oldtoken",
			},
			token:     "oldtoken",
			wantValid: true,
		},
		{
			name: "empty tokens",
			user: &User{
				Username: "testuser",
				Tokens:   []string{},
			},
			token:     "anytoken",
			wantValid: false,
		},
		{
			name: "token in both Tokens and Token field",
			user: &User{
				Username: "testuser",
				Token:    "duplicate",
				Tokens:   []string{"duplicate", "other"},
			},
			token:     "duplicate",
			wantValid: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := userHasToken(tt.user, tt.token)
			if got != tt.wantValid {
				t.Errorf("userHasToken() = %v, want %v", got, tt.wantValid)
			}
		})
	}
}

// TestMultipleTokensScenario 测试多 token 同时有效的场景
func TestMultipleTokensScenario(t *testing.T) {
	user := &User{
		Username: "testuser",
		Tokens:   []string{},
	}

	// 模拟第一次登录
	token1 := "token1"
	user.Tokens = append(user.Tokens, token1)

	// 验证第一个 token 有效
	if !userHasToken(user, token1) {
		t.Error("First token should be valid")
	}

	// 模拟第二次登录（不应该覆盖第一个 token）
	token2 := "token2"
	user.Tokens = append(user.Tokens, token2)

	// 验证两个 token 都有效
	if !userHasToken(user, token1) {
		t.Error("First token should still be valid after second login")
	}
	if !userHasToken(user, token2) {
		t.Error("Second token should be valid")
	}

	// 验证无效的 token
	if userHasToken(user, "invalidtoken") {
		t.Error("Invalid token should not be valid")
	}
}

// TestBackwardCompatibility 测试向后兼容性
func TestBackwardCompatibility(t *testing.T) {
	// 模拟旧数据：只有 Token 字段，没有 Tokens
	oldUser := &User{
		Username: "olduser",
		Token:    "legacytoken",
		Tokens:   nil,
	}

	// 验证旧 token 仍然有效
	if !userHasToken(oldUser, "legacytoken") {
		t.Error("Legacy token should be valid for backward compatibility")
	}

	// 模拟迁移：将旧 Token 迁移到 Tokens
	if oldUser.Token != "" {
		found := false
		for _, t := range oldUser.Tokens {
			if t == oldUser.Token {
				found = true
				break
			}
		}
		if !found {
			oldUser.Tokens = append(oldUser.Tokens, oldUser.Token)
		}
	}

	// 验证迁移后 token 仍然有效
	if !userHasToken(oldUser, "legacytoken") {
		t.Error("Token should still be valid after migration")
	}
}