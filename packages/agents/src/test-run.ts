// ONE-OFF — manual smoke test for buildApprovedDesign(). Run with:
//   tsx --env-file=.env src/test-run.ts
// Uses the default onToolConfirmation (auto-allow + console.warn) so it can
// run unattended. This means the Engineer's PR and the Jira Manager's ticket
// WILL actually be created against the real repo/site — not a dry run.
import { buildApprovedDesign } from "./build";

const DESIGN = `
Add a /health endpoint to the Next.js app (src/app) that returns
{ "status": "ok" } as JSON. This is a tiny smoke-test feature.
`.trim();

buildApprovedDesign(DESIGN).catch((err) => {
  console.error(err);
  process.exit(1);
});
