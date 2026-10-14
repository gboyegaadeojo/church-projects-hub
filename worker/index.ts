import { createApp } from "./app";
import { googleClient } from "./auth/google";
import { runScheduledJobs } from "./jobs/dispatch";

export type { AppEnv } from "./types";

export const app = createApp({ google: googleClient });

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduledJobs(new Date(controller.scheduledTime), env));
  },
} satisfies ExportedHandler<Env>;
