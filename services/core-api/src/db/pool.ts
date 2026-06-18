import { Pool } from "pg";

// Kết nối PostgreSQL 18 (AI_CDP_Pro). Mặc định khớp .env.example cho dev/test.
export const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5433),
  database: process.env.PGDATABASE ?? "AI_CDP_Pro",
  user: process.env.PGUSER ?? "occ_cdp",
  password: process.env.PGPASSWORD ?? "occ_cdp_dev",
  max: 10,
});
