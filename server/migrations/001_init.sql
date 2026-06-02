-- 全新安装初始化（Docker entrypoint 首次启动执行）。
-- 注意：完整 schema 由 Go 程序的 autoMigrate() 统一负责创建与维护，
-- 本文件仅预置默认管理员，使 Docker 容器在 Go 程序启动前即可登录。
-- accounts 等所有业务表均交给 autoMigrate，避免两处定义冲突。

CREATE TABLE IF NOT EXISTS admins (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 默认管理员: admin / admin123（生产环境请通过 cmd/reset_admin 立即改密）
INSERT IGNORE INTO admins (username, password_hash) VALUES
('admin', '$2a$10$CHVZQtMykzHOWd6gluYYyunsXGdjxSQbAJF3lGc30o63pP4Syf5mW');
