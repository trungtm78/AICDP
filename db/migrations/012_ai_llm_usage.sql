-- Migration 012 — AI LLM usage log: theo dõi token/cost + audit mỗi lần gọi LLM (generative).
-- Phục vụ cost tracking + governance ("ai gọi LLM nào, khi nào, bao nhiêu token").

CREATE TABLE IF NOT EXISTS cdp.ai_llm_usage (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task          text NOT NULL,        -- ask | segment | content | explain
  provider      text NOT NULL,        -- anthropic | openai | gemini
  model         text NOT NULL,
  input_tokens  integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  principal_id  text NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_llm_usage_created ON cdp.ai_llm_usage (created_at DESC, id DESC);
