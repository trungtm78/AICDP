# OCC-CDP — OCC Customer Data Platform

Nền tảng **Customer Data Platform enterprise self-host** cho tập đoàn F&B đa thương hiệu OCC (Givral, Kem Tràng Tiền, Hải Hà Kotobuki, Fuji Foods, Origato).

Mục tiêu: hợp nhất danh tính khách hàng (**OCC ID**) xuyên thương hiệu, loyalty hợp nhất, dashboard realtime cho Ban điều hành, AI cross-selling. 1 triệu KH định danh cuối 2026, hướng IPO.

## Nền tảng kỹ thuật
- **RudderStack OSS** — thu thập sự kiện + transformation + reverse-ETL/activation.
- **NestJS** (backend) · **React + Vite** (frontend) · **PostgreSQL 18** (system of record) · **ClickHouse** (OLAP/analytics) · **Redis** (cache) · **MinIO** (object storage).
- Self-host 100% (Docker/Kubernetes).

## Cấu trúc monorepo (pnpm workspaces)
```
packages/   shared-contracts · connector-sdk · ui (design system)
services/   core-api (NestJS: ingestion+identity+loyalty+consent) · analytics-api · ai-service · ...
connectors/ pos/<brand>
apps/       admin-console (:8073) · exec-dashboard
db/         migrations (Postgres) · clickhouse (DDL)
docs/       architecture (tracking-plan-spec, pdpa-compliance, adr)
infra/      docker-compose.dev.yml · k8s · rudderstack · clickhouse
```

## Chạy dev
```bash
cp .env.example .env
docker compose -f infra/docker-compose.dev.yml up -d   # ClickHouse, Redis, MinIO
pnpm install
pnpm dev                                                # core-api :8071, admin-console :8073
```
PostgreSQL 18 chạy local tại `127.0.0.1:5433`, database `AI_CDP_Pro`.

## Tài liệu
- Hệ thiết kế: [DESIGN.md](DESIGN.md)
- Quy ước & quy trình: [CLAUDE.md](CLAUDE.md)
- Kiến trúc: [docs/architecture/](docs/architecture/)
