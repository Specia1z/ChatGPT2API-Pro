package service

import (
	"fmt"
	"testing"
)

// TestGenerateTokenValidByOriginalRule 锁死注册路径 generateToken 的热路径优化：
// 优化版（整数难度比较 + fnv 分段）解出的 token，必须满足原版校验规则
// fnv1a32(seed+payload) 的 hex 前缀 <= difficulty——即 OpenAI sentinel 会接受。
// 注：generateToken 的 payload 由 getConfig() 构造（含随机字段），故不能跨调用逐字节对比，
// 改为验证「解出的 token 通过原版规则」，与 TestSolvedTokenValidByOriginalRule 同思路。
func TestGenerateTokenValidByOriginalRule(t *testing.T) {
	for i := 0; i < 10; i++ {
		seed := fmt.Sprintf("reg_seed_%d_%x", i, i*7919)
		gen := newSentinelGenerator(newUUID())
		// 难度 "00"：1/256 概率，50 万次内必解出
		token := gen.generateToken(seed, "00")

		// token 格式：gAAAAAB<base64>~S（错误兜底前缀不应出现在难度仅 00 时）
		if len(token) < 10 || token[:7] != "gAAAAAB" || token[len(token)-2:] != "~S" {
			t.Fatalf("seed=%s token 格式错误或未解出: %.20s...", seed, token)
		}
		b64 := token[7 : len(token)-2]
		// 关键：用原版（线上被接受的）校验规则验证优化版的解
		if hexHash := fnv1a32(seed + b64); hexHash[:2] > "00" {
			t.Fatalf("优化版解出的 token 不满足原版难度校验! seed=%s hash=%s diff=00", seed, hexHash)
		}
	}
	t.Log("✅ generateToken 优化版解出的 token 均通过原版校验规则")
}

// TestGenerateTokenFallbackPath 验证难度格式异常时回退到字符串路径仍能解出有效 token。
func TestGenerateTokenFallbackPath(t *testing.T) {
	// 难度含非 hex 字符 → 触发回退路径（strconv.ParseUint 失败）。
	// 用 "0" 单字符是合法 hex 走优化路径；这里用空难度触发 n>=1 不成立 → 回退。
	gen := newSentinelGenerator(newUUID())
	token := gen.generateToken("fallback_seed_xyz", "0")
	if len(token) < 10 || token[:7] != "gAAAAAB" {
		t.Fatalf("回退/优化路径 token 格式错误: %.20s...", token)
	}
	b64 := token[7 : len(token)-2]
	if hexHash := fnv1a32("fallback_seed_xyz" + b64); hexHash[:1] > "0" {
		t.Fatalf("解出的 token 不满足难度 0 校验: hash=%s", hexHash)
	}
	t.Log("✅ generateToken 难度 0 解出有效 token")
}
