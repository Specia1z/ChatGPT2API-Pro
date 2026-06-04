# Repository Guidelines

## Project Structure

```
server/                 # Go 1.24 backend
├── main.go             # Entry point (MySQL → Redis → HTTP server)
├── cmd/reset_admin/    # Admin password reset CLI
├── internal/{api,config,middleware,model,service,storage,store}
├── migrations/         # SQL init scripts
└── Dockerfile

web/                    # Next.js 16 + TypeScript + Tailwind CSS 4
├── src/app/            # Route pages (admin/, gallery/, user/, etc.)
├── src/components/     # Shared + shadcn/ui components
└── src/lib/            # API client, auth context, utilities
```

- **server/internal/api/** — HTTP handlers and router (Go `net/http` mux).
- **server/internal/service/** — Business logic: account pool, OpenAI registration, image generation, PoW.
- **server/internal/store/** — MySQL and Redis data access.
- **server/internal/storage/** — File storage abstraction (local disk, S3).

## Build, Test, and Development Commands

```bash
# ── Backend (Go) ──
cd server
go build .                          # Build the server binary
go run .                            # Run locally (requires MySQL + Redis)
go test ./...                       # Run all backend tests
go test -v ./internal/store/...     # Run tests in a specific package
go vet ./...                        # Static analysis

# ── Frontend (Next.js) ──
cd web
npm run dev                         # Dev server at :3000 (proxies /api to :8080)
npm run build                       # Production build (standalone output)
npm start                           # Serve production build

# ── Docker (development) ──
docker-compose up -d                # Start MySQL + Redis
```

## Coding Style & Naming Conventions

- **Go**: Standard `gofmt` formatting. Exported identifiers use PascalCase; unexported use camelCase. Error values follow `err` / `ErrXxx` convention.
- **TypeScript/React**: Components in PascalCase (`admin-sidebar.tsx`). Utility functions in camelCase. Files use kebab-case.
- **CSS**: Tailwind utility classes throughout. No plain CSS files.
- **API paths**: RESTful, lower-case, plural nouns (`/api/users`, `/api/generations`).

No ESLint or Prettier config is committed — rely on `go vet` and editor defaults.

## Testing Guidelines

- **Framework**: Go standard `testing` package only.
- **Naming**: `TestXxx(t *testing.T)` (unit), `BenchmarkXxx(b *testing.B)` (benchmark).
- **Pattern**: Use `t.Skip` when external services (Redis, MySQL) are unavailable.
- **Run**: `go test ./...` from `server/`.
- **Coverage**: Not enforced; prefer testing service and store layers.

## Commit & Pull Request Guidelines

Follow **Conventional Commits**: `<type>(<scope>): <description>`.

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`.

```
feat(web): 移动端布局适配
fix: 去掉写死的兜底代理，默认直连
docs: 添加 README 与后端 .env.example
```

PR requirements:
- Explain *what* and *why*, not just *how*.
- Ensure `go vet ./... && go test ./...` passes.
- Keep changes focused — one logical change per PR.

## Security & Configuration Tips

- Never commit `.env`, `.env.local`, or `.env.prod` (already in `.gitignore`).
- Generate a random `JWT_SECRET` for production: `openssl rand -hex 32`.
- Production secrets are injected via `docker-compose.prod.yml` environment variables — never bake secrets into Docker images.
