-- Migration 033 — RBAC: bổ sung role loyalty_manager / loyalty_ops vào CHECK của api_key + app_user
-- (L9). Drop constraint cũ + add mới (idempotent qua DO block; tên constraint auto = <table>_role_check).

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT unnest(ARRAY['api_key','app_user']) AS tbl LOOP
    -- Bỏ constraint role cũ (nếu có) rồi thêm bản mới gồm 2 role loyalty.
    EXECUTE format('ALTER TABLE cdp.%I DROP CONSTRAINT IF EXISTS %I_role_check', r.tbl, r.tbl);
    EXECUTE format($f$ALTER TABLE cdp.%I ADD CONSTRAINT %I_role_check CHECK (role IN
      ('admin','data_steward','marketer','csr','analyst','compliance','executive','connector','loyalty_manager','loyalty_ops'))$f$, r.tbl, r.tbl);
  END LOOP;
END $$;
