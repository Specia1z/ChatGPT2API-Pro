package service

import (
	"encoding/base64"
	"fmt"
	"strconv"
	"testing"
)

// ── PoW 算法等价性测试 ──────────────────────────────
// 目的：在改动 solveProofOfWork 之前/之后，锁死「优化版与原版逐字节一致」。
// PoW 用于通过 OpenAI 的 sentinel 校验，算法语义必须 100% 不变，否则线上失效。

// origStep 复刻原版内层单次迭代的核心逻辑：构造 payload → base64 → fnv1a32 → 难度比较。
// 这是「黄金标准」，与线上正在跑、且能通过 GPT 校验的实现完全一致。
func origStep(seed, difficulty, prefix, mid, tail string, counter int, elapsed float64) (b64 string, pass bool) {
	buf := make([]byte, 0, 256)
	buf = append(buf, prefix...)
	buf = strconv.AppendInt(buf, int64(counter), 10)
	buf = append(buf, mid...)
	buf = strconv.AppendFloat(buf, elapsed, 'f', -1, 64)
	buf = append(buf, tail...)
	b64 = base64.StdEncoding.EncodeToString(buf)
	pass = fnv1a32(seed+b64)[:len(difficulty)] <= difficulty
	return
}

// optStep 复刻优化版的核心逻辑：复用 buffer base64 + 分段 fnv + 整数难度比较。
func optStep(seedH uint32, diffInt uint64, shift uint, prefix, mid, tail, elapsedStr string,
	counter int, jsonBuf, b64Buf []byte) (b64 []byte, pass bool) {
	jsonBuf = jsonBuf[:0]
	jsonBuf = append(jsonBuf, prefix...)
	jsonBuf = strconv.AppendInt(jsonBuf, int64(counter), 10)
	jsonBuf = append(jsonBuf, mid...)
	jsonBuf = append(jsonBuf, elapsedStr...)
	jsonBuf = append(jsonBuf, tail...)
	encLen := base64.StdEncoding.EncodedLen(len(jsonBuf))
	base64.StdEncoding.Encode(b64Buf, jsonBuf)
	b64 = b64Buf[:encLen]
	pass = uint64(fnv1aFinish(seedH, b64)>>shift) <= diffInt
	return
}

// TestFnvByteVsRune 验证按字节的分段 fnv 与原版按 rune 的 fnv1a32 对 ASCII 输入完全等价。
func TestFnvByteVsRune(t *testing.T) {
	cases := []string{
		"", "a", "abc",
		"abcdef1234567890abcdef1234567890",
		"gAAAAABeyJhbGciOiJSUzI1NiJ9aGVsbG8td29ybGQ=",
		"seed" + "QSAGF==base64payload1234567890ABCDEF",
	}
	for _, s := range cases {
		origHex := fnv1a32(s)
		// 分段：空 seed 累加态 → 续算整串
		got := fnv1aFinish(fnv1aSeed(nil), []byte(s))
		gotHex := fmt.Sprintf("%08x", got)
		if origHex != gotHex {
			t.Errorf("分段 fnv 不一致 input=%q orig=%s got=%s", s, origHex, gotHex)
		}
		// 任意分割点都应一致（seed | more）
		for cut := 0; cut <= len(s); cut++ {
			h := fnv1aSeed([]byte(s[:cut]))
			split := fmt.Sprintf("%08x", fnv1aFinish(h, []byte(s[cut:])))
			if split != origHex {
				t.Errorf("分割 fnv 不一致 input=%q cut=%d orig=%s got=%s", s, cut, origHex, split)
			}
		}
	}
}

// TestDifficultyIntVsStr 验证整数难度比较与原版 hex 字符串前缀比较完全等价（全难度位宽 + 边界）。
func TestDifficultyIntVsStr(t *testing.T) {
	hashes := []uint32{0, 1, 0x0000abcd, 0x000fffff, 0x00100000, 0x12345678, 0xffffffff, 0x0000ffff, 0xabcdef01}
	diffs := []string{"0", "00", "000", "0000", "00000", "000000", "0000000", "00000000", "000f", "00ab", "1234", "ffff", "f"}
	for _, h := range hashes {
		hexStr := fmt.Sprintf("%08x", h)
		for _, d := range diffs {
			n := len(d)
			diffInt, _ := strconv.ParseUint(d, 16, 64)
			shift := uint(32 - n*4)
			strLE := hexStr[:n] <= d
			intLE := uint64(h>>shift) <= diffInt
			if strLE != intLE {
				t.Errorf("难度比较不一致 h=%08x diff=%s strLE=%v intLE=%v", h, d, strLE, intLE)
			}
		}
	}
}

// TestPowStepEquivalence 端到端逐迭代对照：对真实模板与多组 seed/difficulty/counter，
// 断言「优化版 b64 字节」「优化版是否通过」与原版逐项一致。这是最关键的回归锁。
func TestPowStepEquivalence(t *testing.T) {
	ua := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36"
	// 用与 solveProofOfWork 相同方式构造模板片段（固定 ts/sid/rand 以保证可复现）
	prefix := `["1920x1080","Mon Jan 02 2006 15:04:05 GMT+0000 (UTC)",4294705152,`
	mid := `,0,"` + ua + `","https://sentinel.openai.com/sentinel/x/sdk.js",null,null,"en-US",`
	tail := `,"vendorSub-undefined","location","Object",12345,"abc-sid",` + `"",8,1700000000000]`

	seeds := []string{
		"abcdef1234567890abcdef1234567890",
		"0f9c2a", "ZZZZ", "seed_with_mixed_0123",
	}
	diffs := []string{"0", "00", "000", "0000", "f", "ff", "08", "8000"}

	for _, seed := range seeds {
		seedH := fnv1aSeed([]byte(seed))
		jsonBuf := make([]byte, 0, 256)
		b64Buf := make([]byte, 512)
		for _, d := range diffs {
			n := len(d)
			diffInt, _ := strconv.ParseUint(d, 16, 64)
			shift := uint(32 - n*4)
			for _, counter := range []int{0, 1, 7, 42, 1023, 99999, 499999} {
				elapsed := float64(counter % 1000) // 任意 elapsed
				elapsedStr := strconv.FormatFloat(elapsed, 'f', -1, 64)

				oB64, oPass := origStep(seed, d, prefix, mid, tail, counter, elapsed)
				nB64, nPass := optStep(seedH, diffInt, shift, prefix, mid, tail, elapsedStr, counter, jsonBuf, b64Buf)

				if oB64 != string(nB64) {
					t.Fatalf("b64 不一致 seed=%s diff=%s counter=%d\n orig=%s\n opt =%s", seed, d, counter, oB64, string(nB64))
				}
				if oPass != nPass {
					t.Fatalf("难度判定不一致 seed=%s diff=%s counter=%d orig=%v opt=%v", seed, d, counter, oPass, nPass)
				}
			}
		}
	}
	t.Log("✅ 优化版与原版逐迭代逐字节一致")
}

// TestSolvedTokenValidByOriginalRule 用优化后的 solveProofOfWork 真实解题，
// 再用原版校验规则（fnv1a32(seed+b64) 的 hex 前缀 <= difficulty）验证解出的 token 有效。
// 这等价于「OpenAI sentinel 会接受这个 proof」——因为线上原版正是用这套规则被接受的。
func TestSolvedTokenValidByOriginalRule(t *testing.T) {
	ua := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36"
	// 难度 "00" = 前 2 位 hex 为 0，1/256 概率，50 万次内必能解出
	for i := 0; i < 10; i++ {
		seed := fmt.Sprintf("realistic_seed_%d_%x", i, i*7919)
		token := solveProofOfWork(seed, "00", ua)
		if token == "" {
			t.Fatalf("seed=%s 未解出（不应发生，难度仅 00）", seed)
		}
		// token 格式：gAAAAAB<base64>~S
		if len(token) < 10 || token[:7] != "gAAAAAB" || token[len(token)-2:] != "~S" {
			t.Fatalf("token 格式错误: %.20s...", token)
		}
		b64 := token[7 : len(token)-2]
		// 关键：用原版（线上被 GPT 接受的）校验规则验证
		hexHash := fnv1a32(seed + b64)
		if hexHash[:2] > "00" {
			t.Fatalf("解出的 token 不满足原版难度校验! seed=%s hash=%s diff=00", seed, hexHash)
		}
	}
	t.Log("✅ 优化版解出的 token 均通过原版（GPT 接受的）校验规则")
}
