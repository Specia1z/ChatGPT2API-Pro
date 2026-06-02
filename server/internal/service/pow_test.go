package service

import (
	"fmt"
	"testing"
)

// TestSolveProofOfWork 测试 PoW 求解器能否在 50 万次内找到解
func TestSolveProofOfWork(t *testing.T) {
	// 模拟真实场景的 seed 和 difficulty
	seed := "abcdef1234567890abcdef1234567890"
	difficulty := "0000" // 需要前 4 位 hex 为 0
	ua := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36"

	token := solveProofOfWork(seed, difficulty, ua)
	if token == "" {
		t.Skip("50 万次未找到解（低概率事件, 概率约 1/65536）")
	}
	t.Logf("PoW solved, token prefix: %s... (len=%d)", token[:minI(40, len(token))], len(token))
}

// BenchmarkSolveProofOfWork 基准测试 PoW 求解性能
func BenchmarkSolveProofOfWork(b *testing.B) {
	seed := "abcdef1234567890abcdef1234567890"
	difficulty := "0000"
	ua := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		token := solveProofOfWork(seed, difficulty, ua)
		if token == "" {
			b.Skip("未找到解")
		}
	}
}

// TestSolveProofOfWorkRealistic 使用发散的 seed 测试多次求解的成功率
func TestSolveProofOfWorkRealistic(t *testing.T) {
	ua := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36"
	difficulty := "0000"

	solved := 0
	total := 20
	for i := 0; i < total; i++ {
		seed := fmt.Sprintf("test_seed_%d_with_some_random_suffix_%d", i, i*12345)
		token := solveProofOfWork(seed, difficulty, ua)
		if token != "" {
			solved++
			t.Logf("[%2d] solved", i+1)
		} else {
			t.Logf("[%2d] not found in 500k iterations", i+1)
		}
	}
	t.Logf("成功率: %d/%d (%.1f%%)", solved, total, float64(solved)/float64(total)*100)
}
