import type { Pool } from "pg";
import { pool } from "../db/pool.js";

/** Token DI cho Postgres pool — controller nhận pool qua đây (test có thể override). */
export const PG_POOL = Symbol("PG_POOL");

export const pgPoolProvider = {
  provide: PG_POOL,
  useValue: pool as Pool,
};
