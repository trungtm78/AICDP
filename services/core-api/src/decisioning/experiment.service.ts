import type { Pool } from "pg";
import { createHash } from "node:crypto";

// Experimentation: gán biến thể DETERMINISTIC hash(occId+expId) -> treatment/holdout theo
// holdout_pct. Uplift = tỉ lệ chuyển đổi(treatment) − tỉ lệ chuyển đổi(holdout). Chuyển đổi
// demo-grade = có giao dịch SAU thời điểm gán. Không phải bandit online.

export interface Experiment {
  id: string;
  name: string;
  kind: "ab" | "holdout";
  holdoutPct: number;
  status: "running" | "stopped";
  createdAt: string;
}

interface ExpRow { id: string; name: string; kind: Experiment["kind"]; holdout_pct: number; status: Experiment["status"]; created_at: string }
const mapExp = (r: ExpRow): Experiment => ({ id: r.id, name: r.name, kind: r.kind, holdoutPct: r.holdout_pct, status: r.status, createdAt: r.created_at });

export async function listExperiments(pool: Pool): Promise<Experiment[]> {
  const r = await pool.query<ExpRow>("SELECT * FROM cdp.experiment ORDER BY created_at DESC");
  return r.rows.map(mapExp);
}

export async function createExperiment(pool: Pool, a: { name: string; holdoutPct?: number | undefined }): Promise<Experiment> {
  const r = await pool.query<ExpRow>(
    "INSERT INTO cdp.experiment (name, holdout_pct) VALUES ($1,$2) RETURNING *",
    [a.name, a.holdoutPct ?? 20],
  );
  return mapExp(r.rows[0]!);
}

/** Biến thể deterministic cho 1 occ (không ghi DB) — dùng cho enroll journey/activation. */
export function variantFor(experimentId: string, occId: string, holdoutPct: number): "treatment" | "holdout" {
  const h = createHash("sha256").update(`${experimentId}:${occId}`).digest();
  const bucket = h[0]! % 100; // 0..99
  return bucket < holdoutPct ? "holdout" : "treatment";
}

/** Gán toàn bộ khách (có giao dịch) vào experiment theo biến thể deterministic. */
export async function assignAll(pool: Pool, experimentId: string): Promise<number> {
  const exp = await pool.query<ExpRow>("SELECT * FROM cdp.experiment WHERE id=$1", [experimentId]);
  const e = exp.rows[0];
  if (!e) return 0;
  const occs = await pool.query<{ occ_id: string }>(
    "SELECT DISTINCT occ_id::text FROM cdp.canonical_transaction WHERE occ_id IS NOT NULL",
  );
  let n = 0;
  for (const row of occs.rows) {
    const v = variantFor(experimentId, row.occ_id, e.holdout_pct);
    await pool.query(
      `INSERT INTO cdp.experiment_assignment (experiment_id, occ_id, variant)
       VALUES ($1,$2,$3) ON CONFLICT (experiment_id, occ_id) DO NOTHING`,
      [experimentId, row.occ_id, v],
    );
    n++;
  }
  return n;
}

export interface Uplift {
  experimentId: string;
  treatment: { n: number; converted: number; rate: number };
  holdout: { n: number; converted: number; rate: number };
  upliftPct: number; // (rateT - rateH) tính theo điểm phần trăm
}

/** Uplift: chuyển đổi = có giao dịch SAU assigned_at. */
export async function computeUplift(pool: Pool, experimentId: string): Promise<Uplift> {
  const r = await pool.query<{ variant: string; n: string; converted: string }>(
    `SELECT a.variant,
            count(*)::text AS n,
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM cdp.canonical_transaction ct
               WHERE ct.occ_id = a.occ_id AND ct.occ_timestamp > a.assigned_at
            ))::text AS converted
       FROM cdp.experiment_assignment a
      WHERE a.experiment_id = $1
      GROUP BY a.variant`,
    [experimentId],
  );
  const g = (v: string) => {
    const row = r.rows.find((x) => x.variant === v);
    const n = Number(row?.n ?? 0);
    const converted = Number(row?.converted ?? 0);
    return { n, converted, rate: n > 0 ? Math.round((converted / n) * 1000) / 1000 : 0 };
  };
  const treatment = g("treatment");
  const holdout = g("holdout");
  return {
    experimentId, treatment, holdout,
    upliftPct: Math.round((treatment.rate - holdout.rate) * 1000) / 10, // điểm %
  };
}
