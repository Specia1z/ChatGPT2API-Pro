package api

import (
	"encoding/json"
	"net/http"

	"chatgpt2api-pro/internal/service"
	"chatgpt2api-pro/internal/store"
)

type Handler struct {
	MySQL   *store.MySQLStore
	Redis   *store.RedisStore
	Cleaner *service.StorageCleaner
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
