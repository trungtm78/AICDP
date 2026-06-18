import { sharedCh, type Ch } from "../clickhouse/client.js";

/** Token DI cho ClickHouse client — controller nhận qua đây (test có thể override). */
export const CH_CLIENT = Symbol("CH_CLIENT");

export const chClientProvider = {
  provide: CH_CLIENT,
  useFactory: (): Ch => sharedCh(),
};
