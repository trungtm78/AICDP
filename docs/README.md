# Tài liệu hệ thống OCC-CDP

**OCC-CDP** — Customer Data Platform enterprise self-host cho tập đoàn F&B đa thương hiệu OCC (Givral, Kem Tràng Tiền, Hải Hà Kotobuki, Fuji Foods, Origato). Hợp nhất khách hàng xuyên thương hiệu, loyalty & consent hợp nhất, dashboard realtime, AI cross-selling. Audit-grade, hướng IPO, self-host 100%.

> Bản giới thiệu dạng slide: [`OCC-CDP-Introduction.pptx`](./OCC-CDP-Introduction.pptx).

## Mục lục

| # | Tài liệu | Nội dung |
|---|----------|----------|
| 1 | [Kiến trúc & Công nghệ](./01-kien-truc-va-cong-nghe.md) | Sơ đồ kiến trúc, transaction boundary ACID, dual-flow, stack công nghệ chi tiết |
| 2 | [Modules & API](./02-modules-va-api.md) | 11 bounded context, danh mục endpoint, RBAC, error envelope |
| 3 | [Tầng AI (Phase A)](./03-ai.md) | Phân tích hành vi, dự đoán sản phẩm, forecast, decisioning, LLM/generative, governance, lộ trình |
| 4 | [Bảo mật & Tuân thủ](./04-bao-mat-va-tuan-thu.md) | Auth, RBAC, rate-limit, consent, audit, PDPD |
| 5 | [Kiểm thử](./05-kiem-thu.md) | UAT, expert test, property/mutation, quy trình mỗi task |
| 6 | [Cài đặt & Vận hành](./06-cai-dat-va-van-hanh.md) | Yêu cầu, chạy dev, migration, seed dữ liệu demo, biến môi trường |

Tài liệu chuyên sâu khác:
- [Tracking Plan Spec](./architecture/tracking-plan-spec.md) — nguồn sự thật cho schema/SDK.
- [UAT system-wide](./uat/system-wide/) — bộ kiểm thử chấp nhận toàn hệ thống.
- [Expert test](./expert-test/system-wide/) — kiểm thử tầng chuyên gia (property/mutation).

## Tóm tắt nhanh

- **Nền tảng:** RudderStack OSS (ingestion/routing/reverse-ETL) + `core-api` (NestJS) gom identity + loyalty + consent + ingestion trong **một transaction boundary ACID**.
- **Lưu trữ:** PostgreSQL 18 = system of record · ClickHouse = OLAP/feature store · Redis = cache/online store · MinIO = object storage.
- **UI:** admin-console (React 18 + Vite + Tailwind) — 10 workspace: Control Tower, Phân tích, Customers, Audiences, Journeys, Loyalty, Data Ops, Governance, Platform, Trợ lý AI, AI & Governance.
- **AI:** phân tích hành vi (RFM/lifecycle), dự đoán sản phẩm (cross-brand NBA), forecast, decisioning (consent-aware), LLM multi-provider + generative.
- **Chất lượng:** UAT 78/78, expert 33/33, mutation 5/5, core-api 240 test — TDD toàn diện.

## Trạng thái (2026-06)

GĐ1 hoàn tất: 11 bounded context + auth/RBAC + rate-limit end-to-end; **AI Phase A** (heuristic + LLM) đã tích hợp; ClickHouse-live + ML predictive (Phase B/C) theo lộ trình.
