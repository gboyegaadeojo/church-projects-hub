import type { User } from "./db/schema";

export type AuthContext = { user: User; sessionId: string };

export type AppEnv = {
  Bindings: Env;
  Variables: {
    /** Set by requireSession. */
    auth: AuthContext;
  };
};
