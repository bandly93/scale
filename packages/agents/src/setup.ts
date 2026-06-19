// ONE-TIME SETUP — run once with `npx tsx src/setup.ts`, save the printed IDs
// (e.g. into a .env file). Do not call this on every request — agents and the
// environment are persistent, versioned resources you create once and reuse.
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new Anthropic();

function loadAgentConfig(file: string) {
  const raw = fs.readFileSync(path.join(__dirname, "..", "configs", file), "utf8");
  return yaml.load(raw) as Record<string, unknown>;
}

async function main() {
  // 1. Environment (reusable across all agents below)
  const envConfig = yaml.load(
    fs.readFileSync(path.join(__dirname, "..", "environment.yaml"), "utf8"),
  ) as Record<string, unknown>;
  const environment = await client.beta.environments.create(envConfig as any);
  console.log(`ENVIRONMENT_ID=${environment.id}`);

  // 2. Build-pipeline subagents (created before the coordinator, since the
  //    coordinator's multiagent roster references these by ID)
  const engineer = await client.beta.agents.create(loadAgentConfig("engineer.agent.yaml") as any);
  console.log(`ENGINEER_AGENT_ID=${engineer.id}`);

  const tester = await client.beta.agents.create(loadAgentConfig("tester.agent.yaml") as any);
  console.log(`TESTER_AGENT_ID=${tester.id}`);

  const jiraManager = await client.beta.agents.create(
    loadAgentConfig("jira-manager.agent.yaml") as any,
  );
  console.log(`JIRA_MANAGER_AGENT_ID=${jiraManager.id}`);

  // 3. Build Orchestrator — coordinator referencing the three subagents above.
  //    multiagent is a top-level agent field, not a tools[] entry or a session field.
  //    Acts as the PM: plans the work itself, then delegates — no separate Planner agent.
  const orchestrator = await client.beta.agents.create({
    name: "Build Orchestrator",
    model: "claude-opus-4-8",
    system:
      "You act as the PM for turning a design/feature request into working, tested, " +
      "tracked code. You plan the work yourself — break the request into a sequence of " +
      "self-contained tasks — then delegate to your roster of subagents; they cannot " +
      "delegate to each other or to you, so every handoff must go through you directly, " +
      "and each instruction you give must be self-contained (subagent threads do not " +
      "share context with each other or see your plan unless you include it). For each " +
      "task: (1) tell the Jira Manager to open a ticket for it; (2) delegate the " +
      "implementation to the Engineer; (3) once the Engineer reports a pull request is " +
      "open, tell the Jira Manager to move the ticket to \"In Review\"; (4) delegate " +
      "verification to the Tester; (5) on a pass, tell the Jira Manager to move the " +
      "ticket to \"Done\"; on a failure, delegate the fix back to the Engineer and tell " +
      "the Jira Manager to leave the ticket where it is. Do not implement, test, or " +
      "manage tickets yourself — only the named subagent for each job does that work.",
    tools: [{ type: "agent_toolset_20260401", default_config: { enabled: true } }],
    multiagent: {
      type: "coordinator",
      agents: [engineer.id, tester.id, jiraManager.id],
    },
  });
  console.log(`ORCHESTRATOR_AGENT_ID=${orchestrator.id}`);

  console.log("\nSave the IDs above into your .env file.");
  console.log(
    `Console: https://platform.claude.com/workspaces/default/sessions (watch sessions as they run)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
