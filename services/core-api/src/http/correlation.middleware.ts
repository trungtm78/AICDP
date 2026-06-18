import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

/** Gắn correlation_id cho mỗi request (ưu tiên header x-correlation-id nếu có). */
export function correlationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header("x-correlation-id");
  const correlationId = incoming && incoming.length > 0 ? incoming : randomUUID();
  (req as Request & { correlationId: string }).correlationId = correlationId;
  res.setHeader("x-correlation-id", correlationId);
  next();
}

export function getCorrelationId(req: Request): string {
  return (req as Request & { correlationId?: string }).correlationId ?? "unknown";
}
