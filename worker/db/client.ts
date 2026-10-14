import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb(env: Pick<Env, "DB">) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
