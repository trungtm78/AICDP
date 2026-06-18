/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL của core-api. Rỗng = same-origin (dev dùng Vite proxy /v1; prod cần reverse-proxy /v1 -> core-api). */
  readonly VITE_API_BASE_URL?: string;
  /** API key gửi qua Bearer. DEV: dùng key admin seed sẵn; PROD: thay bằng login/JWT (không nhúng key admin vào SPA). */
  readonly VITE_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
