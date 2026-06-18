-- DEV-ONLY seed: cấp một API key admin để admin-console hoạt động ở môi trường dev.
-- KHÔNG chạy ở production. Raw key dev = 'occ-dev-admin-key-2026' (đặt VITE_API_KEY khớp).
-- Chạy thủ công: psql -h 127.0.0.1 -p 5433 -U postgres -d AI_CDP_Pro -f db/seeds/dev_admin_key.sql
-- Production: cấp key qua công cụ vận hành, đặt role tối thiểu cần thiết, KHÔNG dùng key này.

INSERT INTO cdp.api_key (name, role, key_hash)
VALUES ('dev-admin', 'admin', encode(sha256('occ-dev-admin-key-2026'::bytea), 'hex'))
ON CONFLICT (key_hash) DO NOTHING;
