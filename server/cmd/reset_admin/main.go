package main

import (
	"fmt"
	"os"

	"chatgpt2api-pro/internal/config"
	"chatgpt2api-pro/internal/store"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	if len(os.Args) < 3 {
		fmt.Println("用法: reset_admin <username> <password>")
		os.Exit(1)
	}

	username := os.Args[1]
	password := os.Args[2]

	cfg := config.Load()

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		fmt.Println("生成密码失败:", err)
		os.Exit(1)
	}

	mysql, err := store.NewMySQLStore(cfg.MySQLDSN)
	if err != nil {
		fmt.Println("MySQL 连接失败:", err)
		os.Exit(1)
	}
	defer mysql.Close()

	_, err = mysql.RawExec(`INSERT INTO admins (username, password_hash) VALUES (?, ?) 
		ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`, username, string(hash))
	if err != nil {
		fmt.Println("写入失败:", err)
		os.Exit(1)
	}

	fmt.Printf("已重置 %s 密码为 %s\n", username, password)
}
