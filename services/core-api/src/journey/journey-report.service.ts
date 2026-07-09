import type { Pool } from "pg";
import type { JourneyDefinition } from "./journey.types.js";

// Journey Analytics: funnel theo node + đếm trạng thái + attribution (đơn/doanh thu/điểm/
// activation sau enroll) + enrollment theo ngày. Nguồn: journey_participant + journey_step_run
// + canonical_transaction. Attribution v1 chỉ cộng order_completed (chưa refund).

export interface FunnelStep {
  nodeId: string;
  nodeType: string;
  reached: number;
}
export interface JourneyReport {
  entered: number;
  active: number;
  completed: number;
  exited: number;
  failed: number;
  exitReasons: { reason: string; count: number }[];
  funnel: FunnelStep[];
  attribution: {
    windowDays: number;
    orders: number;
    revenue: number;
    convertedCustomers: number;
    loyaltyPointsIssued: number;
    activationsAllowed: number;
    activationsSuppressed: number;
  };
  enrollmentByDay: { day: string; count: number }[];
}

/** Thứ tự node từ entry (BFS theo cạnh) — cho trục funnel. */
function nodeOrder(def: JourneyDefinition): { id: string; type: string }[] {
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const n of def.nodes) adj.set(n.id, []);
  for (const e of def.edges) adj.get(e.from)?.push(e.to);
  const entry = def.nodes.find((n) => n.type === "entry");
  const order: { id: string; type: string }[] = [];
  const seen = new Set<string>();
  const queue: string[] = entry ? [entry.id] : [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (node) order.push({ id: node.id, type: node.type });
    for (const nxt of adj.get(id) ?? []) if (!seen.has(nxt)) queue.push(nxt);
  }
  // node lẻ (không nối) vẫn liệt kê cuối cho đủ.
  for (const n of def.nodes) if (!seen.has(n.id)) order.push({ id: n.id, type: n.type });
  return order;
}

export async function journeyReport(pool: Pool, journeyId: string, windowDays = 7): Promise<JourneyReport> {
  const w = Number.isFinite(windowDays) && windowDays > 0 ? Math.min(windowDays, 365) : 7;

  // 1) Đếm trạng thái participant.
  const st = await pool.query<{ status: string; n: string }>(
    "SELECT status, count(*) AS n FROM cdp.journey_participant WHERE journey_id=$1 GROUP BY status",
    [journeyId],
  );
  const byStatus: Record<string, number> = {};
  for (const r of st.rows) byStatus[r.status] = Number(r.n);
  const entered = Object.values(byStatus).reduce((a, b) => a + b, 0);

  const er = await pool.query<{ reason: string; n: string }>(
    `SELECT exit_reason AS reason, count(*) AS n FROM cdp.journey_participant
      WHERE journey_id=$1 AND status IN ('exited','failed') AND exit_reason IS NOT NULL
      GROUP BY exit_reason ORDER BY n DESC`,
    [journeyId],
  );

  // 2) Funnel: reached per node (distinct participant có step_run node đó). Entry = entered.
  const reached = await pool.query<{ node_id: string; node_type: string; n: string }>(
    `SELECT s.node_id, s.node_type, count(DISTINCT s.participant_id) AS n
       FROM cdp.journey_step_run s JOIN cdp.journey_participant p ON p.id = s.participant_id
      WHERE p.journey_id=$1 GROUP BY s.node_id, s.node_type`,
    [journeyId],
  );
  const reachedMap = new Map(reached.rows.map((r) => [r.node_id, Number(r.n)]));

  const jv = await pool.query<{ definition: JourneyDefinition | null }>(
    `SELECT v.definition FROM cdp.journey j
       JOIN cdp.journey_version v ON v.journey_id=j.journey_id AND v.version=j.published_version
      WHERE j.journey_id=$1`,
    [journeyId],
  );
  const def = jv.rows[0]?.definition ?? null;
  const funnel: FunnelStep[] = [];
  if (def) {
    // entry = tất cả đã enroll; các node khác (gồm exit) = số participant có step_run node đó.
    for (const node of nodeOrder(def)) {
      funnel.push({ nodeId: node.id, nodeType: node.type, reached: node.type === "entry" ? entered : reachedMap.get(node.id) ?? 0 });
    }
    // Không bỏ sót: node có step_run nhưng không thuộc definition hiện tại (participant version cũ).
    const inFunnel = new Set(funnel.map((f) => f.nodeId));
    for (const [nodeId, n] of reachedMap) if (!inFunnel.has(nodeId)) funnel.push({ nodeId, nodeType: "?", reached: n });
  } else {
    for (const [nodeId, n] of reachedMap) funnel.push({ nodeId, nodeType: "?", reached: n });
  }

  // 3) Attribution: đơn/doanh thu sau enrolled_at trong window.
  const attr = await pool.query<{ orders: string; revenue: string; converted: string }>(
    `SELECT count(*) AS orders, COALESCE(sum(ct.total),0) AS revenue, count(DISTINCT p.occ_id) AS converted
       FROM cdp.journey_participant p
       JOIN cdp.canonical_transaction ct
         ON ct.occ_id = p.occ_id
        AND ct.occ_timestamp >= p.enrolled_at
        AND ct.occ_timestamp <  p.enrolled_at + make_interval(days => $2)
      WHERE p.journey_id=$1`,
    [journeyId, w],
  );

  const loy = await pool.query<{ pts: string }>(
    `SELECT COALESCE(sum((s.result->>'points')::bigint),0) AS pts
       FROM cdp.journey_step_run s JOIN cdp.journey_participant p ON p.id=s.participant_id
      WHERE p.journey_id=$1 AND s.node_type='action' AND s.status='done'
        AND s.result->>'kind'='loyalty_bonus'`,
    [journeyId],
  );
  const act = await pool.query<{ allowed: string; suppressed: string }>(
    `SELECT COALESCE(sum((s.result->>'allowedCount')::int),0) AS allowed,
            COALESCE(sum((s.result->>'suppressedCount')::int),0) AS suppressed
       FROM cdp.journey_step_run s JOIN cdp.journey_participant p ON p.id=s.participant_id
      WHERE p.journey_id=$1 AND s.node_type='action' AND s.status='done'
        AND s.result->>'kind'='activation'`,
    [journeyId],
  );

  const days = await pool.query<{ day: string; n: string }>(
    `SELECT to_char(date(enrolled_at),'YYYY-MM-DD') AS day, count(*) AS n
       FROM cdp.journey_participant WHERE journey_id=$1 GROUP BY 1 ORDER BY 1`,
    [journeyId],
  );

  return {
    entered,
    active: byStatus.active ?? 0,
    completed: byStatus.completed ?? 0,
    exited: byStatus.exited ?? 0,
    failed: byStatus.failed ?? 0,
    exitReasons: er.rows.map((r) => ({ reason: r.reason, count: Number(r.n) })),
    funnel,
    attribution: {
      windowDays: w,
      orders: Number(attr.rows[0]!.orders),
      revenue: Number(attr.rows[0]!.revenue),
      convertedCustomers: Number(attr.rows[0]!.converted),
      loyaltyPointsIssued: Number(loy.rows[0]!.pts),
      activationsAllowed: Number(act.rows[0]!.allowed),
      activationsSuppressed: Number(act.rows[0]!.suppressed),
    },
    enrollmentByDay: days.rows.map((r) => ({ day: r.day, count: Number(r.n) })),
  };
}
