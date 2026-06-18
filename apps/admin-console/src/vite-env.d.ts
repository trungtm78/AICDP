/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL của core-api. Rỗng = same-origin (dev dùng Vite proxy /v1; prod cần reverse-proxy /v1 -> core-api). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
