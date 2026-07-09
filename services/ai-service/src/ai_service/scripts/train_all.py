"""CLI train tất cả model (dùng cho `docker compose run` hoặc cron). In metric ra stdout."""
from __future__ import annotations

import json

from ..training.pipeline import train_all


def main() -> None:
    result = train_all()
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
