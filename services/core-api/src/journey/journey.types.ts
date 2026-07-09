import type { SegmentCriteria } from "../segment/segment.service.js";

// Định nghĩa graph journey (lưu trong cdp.journey.definition jsonb, snapshot khi publish).
//
//   entry ──► [wait|condition|action]* ──► exit
//   condition: 2 cạnh nhãn 'yes'/'no'. Các node khác: 1 cạnh ra (branch null).

export type NodeType = "entry" | "wait" | "condition" | "action" | "exit";

export type TriggerType = "event" | "segment" | "manual";

export interface EntryConfig {
  trigger: TriggerType;
  eventName?: string; // khi trigger='event' (vd 'order_completed')
  segment?: SegmentCriteria; // khi trigger='segment'
}

export interface WaitConfig {
  delayMinutes: number;
}

// Điều kiện đánh giá trên customer_feature / consent (explainable, tái dùng feature store).
export type ConditionPredicate =
  | { kind: "lifecycle"; equals: string }
  | { kind: "churnRiskGte"; value: number }
  | { kind: "propensityGte"; value: number }
  | { kind: "loyaltyMinGte"; value: number }
  | { kind: "favoriteCategory"; equals: string }
  | { kind: "consentGranted"; purpose: string };

export interface ConditionConfig {
  predicate: ConditionPredicate;
}

export type ActionConfig =
  | { kind: "activation"; purpose: string; channel: string; destination: string }
  | { kind: "loyalty_bonus"; points: number };

export type NodeConfig = EntryConfig | WaitConfig | ConditionConfig | ActionConfig | Record<string, never>;

export interface JourneyNode {
  id: string;
  type: NodeType;
  config?: NodeConfig;
  pos?: { x: number; y: number };
}

export interface JourneyEdge {
  from: string;
  to: string;
  branch?: "yes" | "no";
}

export interface JourneyDefinition {
  nodes: JourneyNode[];
  edges: JourneyEdge[];
}

export type JourneyStatus = "draft" | "active" | "paused" | "archived";
export type ParticipantStatus = "active" | "completed" | "exited" | "failed";

/** Lỗi validate graph (publish). */
export class JourneyValidationError extends Error {
  readonly code = "JOURNEY_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "JourneyValidationError";
  }
}

/** Lỗi phân loại khi chạy node (transient → retry; permanent → fail ngay). */
export class JourneyActionError extends Error {
  readonly transient: boolean;
  constructor(message: string, transient: boolean) {
    super(message);
    this.name = "JourneyActionError";
    this.transient = transient;
  }
}
