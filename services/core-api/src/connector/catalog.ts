// Catalog connector dựng sẵn — bám hệ sinh thái RudderStack OSS thật (200+ destinations,
// SDK web/mobile/server, warehouse, reverse-ETL, webhook) + kênh Việt Nam (Zalo ZNS, VietGuys).
// Đây là dữ liệu TĨNH (không đổi lúc chạy); connector tuỳ biến của user hợp nhất từ cdp.connector.

export interface ConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "url" | "select";
  placeholder?: string;
  secret?: boolean;
  options?: string[];
}

export type ConnectorDirection = "source" | "destination";
export type ConnectorTransport = "rest" | "webhook" | "database" | "sdk" | "warehouse";

export interface CatalogConnector {
  key: string;
  name: string;
  direction: ConnectorDirection;
  category: string;
  transport: ConnectorTransport;
  vn?: boolean;
  blurb: string;
  configFields: ConfigField[];
  isCustom?: boolean;
}

const apiKeyField: ConfigField = { key: "apiKey", label: "API key", type: "password", secret: true, placeholder: "••••••••" };
const webhookUrl: ConfigField = { key: "webhookUrl", label: "Webhook URL", type: "url", placeholder: "https://…" };

// ── Sources (inbound) ──
const SOURCES: CatalogConnector[] = [
  { key: "src_js", name: "JavaScript SDK (Web)", direction: "source", category: "Event Stream · SDK", transport: "sdk", blurb: "Thu sự kiện từ website qua RudderStack JS SDK.", configFields: [{ key: "writeKey", label: "Write key", type: "text", placeholder: "wk_…" }] },
  { key: "src_android", name: "Android SDK", direction: "source", category: "Event Stream · SDK", transport: "sdk", blurb: "Thu sự kiện từ app Android.", configFields: [{ key: "writeKey", label: "Write key", type: "text" }] },
  { key: "src_ios", name: "iOS SDK", direction: "source", category: "Event Stream · SDK", transport: "sdk", blurb: "Thu sự kiện từ app iOS.", configFields: [{ key: "writeKey", label: "Write key", type: "text" }] },
  { key: "src_reactnative", name: "React Native SDK", direction: "source", category: "Event Stream · SDK", transport: "sdk", blurb: "Thu sự kiện từ app đa nền tảng.", configFields: [{ key: "writeKey", label: "Write key", type: "text" }] },
  { key: "src_node", name: "Node.js SDK (Server)", direction: "source", category: "Event Stream · Server", transport: "sdk", blurb: "Gửi sự kiện server-to-server.", configFields: [{ key: "writeKey", label: "Write key", type: "text" }] },
  { key: "src_http", name: "HTTP API", direction: "source", category: "Event Stream · API", transport: "rest", blurb: "Nạp sự kiện qua REST — dùng cho POS/PMS.", configFields: [{ key: "endpoint", label: "Endpoint", type: "url", placeholder: "/v1/ingest" }, apiKeyField] },
  { key: "src_webhook", name: "Webhook Source", direction: "source", category: "Event Stream · Webhook", transport: "webhook", blurb: "Bất kỳ hệ thống nào hỗ trợ webhook.", configFields: [webhookUrl] },
  { key: "src_pos", name: "POS (Givral / Kem Tràng Tiền / Fuji)", direction: "source", category: "Nguồn OCH", transport: "webhook", blurb: "Đẩy giao dịch bán hàng F&B realtime.", configFields: [webhookUrl, apiKeyField] },
  { key: "src_pms", name: "PMS Khách sạn (Sunrise / StarCity / Dusit)", direction: "source", category: "Nguồn OCH", transport: "webhook", blurb: "Đẩy đặt phòng & lưu trú.", configFields: [webhookUrl, apiKeyField] },
  { key: "src_ecommerce", name: "E-commerce", direction: "source", category: "Nguồn OCH", transport: "rest", blurb: "Đơn hàng website thương mại điện tử.", configFields: [{ key: "endpoint", label: "Endpoint", type: "url" }, apiKeyField] },
  { key: "src_form_cskh", name: "Form CSKH", direction: "source", category: "Nguồn OCH", transport: "webhook", blurb: "Thông tin khách từ tổng đài / form.", configFields: [webhookUrl] },
  { key: "src_pg", name: "PostgreSQL (Reverse-ETL)", direction: "source", category: "Warehouse / Cloud", transport: "database", blurb: "Đọc dữ liệu từ kho quan hệ.", configFields: [{ key: "host", label: "Host", type: "text" }, { key: "database", label: "Database", type: "text" }, apiKeyField] },
  { key: "src_snowflake", name: "Snowflake (Reverse-ETL)", direction: "source", category: "Warehouse / Cloud", transport: "warehouse", blurb: "Kích hoạt dữ liệu từ Snowflake.", configFields: [{ key: "account", label: "Account", type: "text" }, apiKeyField] },
  { key: "src_salesforce", name: "Salesforce (Cloud)", direction: "source", category: "Warehouse / Cloud", transport: "rest", blurb: "Đồng bộ đối tượng CRM.", configFields: [apiKeyField] },
  // ── Cổng thanh toán VN (IPN — xác thực checksum/chữ ký, fail-closed) ──
  { key: "src_vnpay", name: "VNPay (IPN)", direction: "source", category: "Cổng thanh toán VN", transport: "webhook", vn: true, blurb: "Nhận IPN thanh toán VNPay (HMAC-SHA512).", configFields: [{ key: "secretKey", label: "Secret hash key (vnp_HashSecret)", type: "password", secret: true }, { key: "merchantId", label: "Terminal code (vnp_TmnCode)", type: "text" }, { key: "brand_id", label: "Brand", type: "text" }, { key: "store_id", label: "Store", type: "text" }] },
  { key: "src_momo", name: "MoMo (IPN)", direction: "source", category: "Cổng thanh toán VN", transport: "webhook", vn: true, blurb: "Nhận IPN thanh toán MoMo (HMAC-SHA256).", configFields: [{ key: "secretKey", label: "Secret key", type: "password", secret: true }, { key: "accessKey", label: "Access key", type: "text" }, { key: "merchantId", label: "Partner code", type: "text" }, { key: "brand_id", label: "Brand", type: "text" }, { key: "store_id", label: "Store", type: "text" }] },
  { key: "src_zalopay", name: "ZaloPay (Callback)", direction: "source", category: "Cổng thanh toán VN", transport: "webhook", vn: true, blurb: "Nhận callback thanh toán ZaloPay (HMAC-SHA256 key2).", configFields: [{ key: "secretKey", label: "Key2", type: "password", secret: true }, { key: "merchantId", label: "App ID", type: "text" }, { key: "brand_id", label: "Brand", type: "text" }, { key: "store_id", label: "Store", type: "text" }] },
];

// ── Destinations (outbound) ──
const DESTINATIONS: CatalogConnector[] = [
  { key: "dst_ga4", name: "Google Analytics 4", direction: "destination", category: "Analytics", transport: "rest", blurb: "Gửi sự kiện web/app sang GA4.", configFields: [{ key: "measurementId", label: "Measurement ID", type: "text" }, apiKeyField] },
  { key: "dst_amplitude", name: "Amplitude", direction: "destination", category: "Analytics", transport: "rest", blurb: "Phân tích hành vi sản phẩm.", configFields: [apiKeyField] },
  { key: "dst_mixpanel", name: "Mixpanel", direction: "destination", category: "Analytics", transport: "rest", blurb: "Phân tích sự kiện & funnel.", configFields: [{ key: "projectToken", label: "Project token", type: "password", secret: true }] },
  { key: "dst_braze", name: "Braze", direction: "destination", category: "Marketing / Engagement", transport: "rest", blurb: "Đa kênh: email/push/in-app.", configFields: [apiKeyField, { key: "endpoint", label: "REST endpoint", type: "url" }] },
  { key: "dst_iterable", name: "Iterable", direction: "destination", category: "Marketing / Engagement", transport: "rest", blurb: "Chiến dịch marketing đa kênh.", configFields: [apiKeyField] },
  { key: "dst_klaviyo", name: "Klaviyo", direction: "destination", category: "Marketing / Engagement", transport: "rest", blurb: "Email/SMS cho thương mại.", configFields: [apiKeyField] },
  { key: "dst_customerio", name: "Customer.io", direction: "destination", category: "Marketing / Engagement", transport: "rest", blurb: "Tự động hoá vòng đời.", configFields: [apiKeyField, { key: "siteId", label: "Site ID", type: "text" }] },
  { key: "dst_mailchimp", name: "Mailchimp", direction: "destination", category: "Marketing / Engagement", transport: "rest", blurb: "Email marketing.", configFields: [apiKeyField] },
  { key: "dst_google_ads", name: "Google Ads (Audience)", direction: "destination", category: "Advertising / Audiences", transport: "rest", blurb: "Đẩy tệp khách hàng làm audience.", configFields: [{ key: "customerId", label: "Customer ID", type: "text" }, apiKeyField] },
  { key: "dst_meta_ads", name: "Meta (Facebook) Ads", direction: "destination", category: "Advertising / Audiences", transport: "rest", blurb: "Custom Audience Facebook/Instagram.", configFields: [{ key: "adAccountId", label: "Ad account ID", type: "text" }, apiKeyField] },
  { key: "dst_salesforce", name: "Salesforce", direction: "destination", category: "CRM", transport: "rest", blurb: "Đồng bộ lead/contact.", configFields: [apiKeyField] },
  { key: "dst_hubspot", name: "HubSpot", direction: "destination", category: "CRM", transport: "rest", blurb: "CRM & marketing.", configFields: [apiKeyField] },
  { key: "dst_sendgrid", name: "SendGrid", direction: "destination", category: "Email / SMS", transport: "rest", blurb: "Gửi email giao dịch & marketing.", configFields: [apiKeyField, { key: "fromEmail", label: "From email", type: "text" }] },
  { key: "dst_twilio", name: "Twilio (SMS)", direction: "destination", category: "Email / SMS", transport: "rest", blurb: "Gửi SMS quốc tế.", configFields: [{ key: "accountSid", label: "Account SID", type: "text" }, apiKeyField] },
  { key: "dst_zalo_zns", name: "Zalo ZNS", direction: "destination", category: "Kênh Việt Nam", transport: "webhook", vn: true, blurb: "Gửi Zalo Notification Service — kênh chăm sóc phổ biến tại VN.", configFields: [{ key: "oaId", label: "Official Account ID", type: "text" }, apiKeyField, { key: "templateId", label: "Template ID", type: "text" }] },
  { key: "dst_vietguys", name: "VietGuys (SMS Brandname)", direction: "destination", category: "Kênh Việt Nam", transport: "rest", vn: true, blurb: "SMS brandname trong nước.", configFields: [{ key: "brandname", label: "Brandname", type: "text" }, apiKeyField] },
  { key: "dst_snowflake", name: "Snowflake", direction: "destination", category: "Warehouse / BI", transport: "warehouse", blurb: "Kho dữ liệu đám mây.", configFields: [{ key: "account", label: "Account", type: "text" }, apiKeyField] },
  { key: "dst_bigquery", name: "Google BigQuery", direction: "destination", category: "Warehouse / BI", transport: "warehouse", blurb: "Kho dữ liệu Google.", configFields: [{ key: "projectId", label: "Project ID", type: "text" }, apiKeyField] },
  { key: "dst_redshift", name: "Amazon Redshift", direction: "destination", category: "Warehouse / BI", transport: "warehouse", blurb: "Kho dữ liệu AWS.", configFields: [{ key: "host", label: "Host", type: "text" }, apiKeyField] },
  { key: "dst_clickhouse", name: "ClickHouse", direction: "destination", category: "Warehouse / BI", transport: "warehouse", blurb: "OLAP phân tích cột (đang dùng nội bộ).", configFields: [{ key: "host", label: "Host", type: "text" }] },
  { key: "dst_kafka", name: "Apache Kafka", direction: "destination", category: "Streaming / Custom", transport: "webhook", blurb: "Streaming sự kiện.", configFields: [{ key: "brokers", label: "Brokers", type: "text" }, { key: "topic", label: "Topic", type: "text" }] },
  { key: "dst_webhook", name: "Webhook", direction: "destination", category: "Streaming / Custom", transport: "webhook", blurb: "Đẩy sự kiện tới endpoint tuỳ ý.", configFields: [webhookUrl] },
  { key: "dst_s3", name: "Amazon S3", direction: "destination", category: "Streaming / Custom", transport: "warehouse", blurb: "Lưu trữ đối tượng theo lô.", configFields: [{ key: "bucket", label: "Bucket", type: "text" }, apiKeyField] },
];

export const CATALOG_CONNECTORS: CatalogConnector[] = [...SOURCES, ...DESTINATIONS];

// ── Mô hình dựng sẵn (áp dụng nhanh) ──
export interface CatalogTemplate {
  key: string;
  name: string;
  blurb: string;
  kind: "connection" | "pipeline";
  // connection template
  connectorKey?: string;
  direction?: ConnectorDirection;
  // pipeline template: chuỗi connector source → (transform) → destination
  pipelineKind?: "event_stream" | "etl" | "reverse_etl";
  sourceKey?: string;
  transform?: string;
  destinationKey?: string;
}

export const CATALOG_TEMPLATES: CatalogTemplate[] = [
  { key: "tpl_pos_cdp", name: "Thu POS F&B → CDP", blurb: "Nạp giao dịch Givral/KTT/Fuji realtime vào CDP.", kind: "pipeline", pipelineKind: "event_stream", sourceKey: "src_pos", transform: "normalize", destinationKey: "dst_clickhouse" },
  { key: "tpl_pms_cdp", name: "Thu PMS Khách sạn → CDP", blurb: "Nạp đặt phòng Sunrise/StarCity/Dusit vào CDP.", kind: "pipeline", pipelineKind: "event_stream", sourceKey: "src_pms", transform: "normalize", destinationKey: "dst_clickhouse" },
  { key: "tpl_web_app", name: "Web & App → CDP", blurb: "Thu hành vi website + mobile qua SDK.", kind: "connection", connectorKey: "src_js", direction: "source" },
  { key: "tpl_cdp_zalo", name: "CDP → Zalo ZNS", blurb: "Gửi chăm sóc qua Zalo (lọc theo consent).", kind: "pipeline", pipelineKind: "reverse_etl", sourceKey: "src_pg", transform: "consent_filter", destinationKey: "dst_zalo_zns" },
  { key: "tpl_cdp_email", name: "CDP → Email (SendGrid)", blurb: "Kích hoạt email cá nhân hoá.", kind: "connection", connectorKey: "dst_sendgrid", direction: "destination" },
  { key: "tpl_cdp_sms", name: "CDP → SMS (VietGuys)", blurb: "SMS brandname trong nước.", kind: "connection", connectorKey: "dst_vietguys", direction: "destination" },
  { key: "tpl_cdp_google_ads", name: "CDP → Google Ads Audience", blurb: "Đẩy tệp khách làm audience quảng cáo.", kind: "pipeline", pipelineKind: "reverse_etl", sourceKey: "src_pg", transform: "audience", destinationKey: "dst_google_ads" },
  { key: "tpl_cdp_meta_ads", name: "CDP → Meta Ads Audience", blurb: "Custom Audience Facebook/Instagram.", kind: "connection", connectorKey: "dst_meta_ads", direction: "destination" },
  { key: "tpl_cdp_warehouse", name: "CDP → Kho dữ liệu/BI", blurb: "Reverse-ETL sang Snowflake/BigQuery/ClickHouse.", kind: "connection", connectorKey: "dst_snowflake", direction: "destination" },
  { key: "tpl_cdp_crm", name: "CDP → CRM (Salesforce)", blurb: "Đồng bộ khách sang CRM.", kind: "connection", connectorKey: "dst_salesforce", direction: "destination" },
];

export const connectorByKey = (key: string): CatalogConnector | undefined =>
  CATALOG_CONNECTORS.find((c) => c.key === key);
export const templateByKey = (key: string): CatalogTemplate | undefined =>
  CATALOG_TEMPLATES.find((t) => t.key === key);
