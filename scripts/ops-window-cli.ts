// Used by .github/workflows/deploy.yml and backup.yml (runs directly in Node 24 with type stripping).
//   node scripts/ops-window-cli.ts deploy           exits 1 inside the Saturday–Sunday freeze (NFR-6)
//   node scripts/ops-window-cli.ts backup "0 8 * * *"  prints run=true|false for $GITHUB_OUTPUT (NFR-8)

import { isBackupSlot, isDeployFrozen } from "./ops-window.ts";

const [command, schedule] = process.argv.slice(2);
const now = new Date();

if (command === "deploy") {
  if (isDeployFrozen(now)) {
    console.error("Deploys are blocked from Saturday 6 pm to Sunday 2 pm Winnipeg time (NFR-6). Re-run this workflow after Sunday 2 pm.");
    process.exit(1);
  }
  console.log("Outside the Sunday freeze window; deploying.");
} else if (command === "backup") {
  const hour = Number(schedule?.trim().split(/\s+/)[1]);
  if (!Number.isInteger(hour)) {
    console.error(`Expected a cron schedule like "0 8 * * *", got: ${schedule}`);
    process.exit(1);
  }
  console.log(`run=${isBackupSlot(hour, now)}`);
} else {
  console.error("Usage: node scripts/ops-window-cli.ts deploy | backup \"<cron>\"");
  process.exit(1);
}
