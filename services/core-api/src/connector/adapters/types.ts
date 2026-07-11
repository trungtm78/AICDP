// Hợp đồng adapter chung cho connector (outbound gửi ra + inbound pull). Adapter cụ thể (GA4,
// Zalo, webhook, ERP…) hiện thực interface này; registry map connectorKey -> adapter.

export interface OutboundMessage {
  channel: string;                       // zalo_zns|webhook|email|sms|analytics|...
  recipient?: string | undefined;        // phone/email/url (KHÔNG phải secret)
  payload: Record<string, unknown>;      // dữ liệu đã map sang schema đích
  occId?: string | undefined;
}

export interface DeliveryResult {
  status: "sent" | "failed";
  providerMessageId?: string | undefined;
  error?: string | undefined;
}

export interface HealthResult {
  ok: boolean;
  error?: string | undefined;
}

/** Adapter OUTBOUND: gửi 1 message tới destination + health-check. config đã GIẢI MÃ secret. */
export interface OutboundAdapter {
  key: string;                           // connectorKey phục vụ (vd 'dst_webhook','dst_zalo_zns')
  deliver(config: Record<string, unknown>, msg: OutboundMessage): Promise<DeliveryResult>;
  healthCheck(config: Record<string, unknown>): Promise<HealthResult>;
}

export interface PulledEvent {
  type: "order_completed" | "identify";
  data: Record<string, unknown>;
  /** Cursor keyset của CHÍNH event này (để runner tiến cursor tới row đã xử lý xong — không skip). */
  cursor?: Record<string, unknown> | undefined;
}

/** Adapter INBOUND kiểu PULL (reverse-ETL): kéo event từ nguồn theo cursor. */
export interface InboundPullAdapter {
  key: string;
  pull(
    config: Record<string, unknown>,
    cursor: Record<string, unknown> | null,
  ): Promise<{ events: PulledEvent[]; nextCursor: Record<string, unknown> | null }>;
}
