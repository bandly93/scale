// RUNTIME — call this with an approved design/feature request.
// Starts the Build Orchestrator, which plans the work and delegates to
// Engineer -> Tester -> Jira Manager.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const ORCHESTRATOR_AGENT_ID = process.env.ORCHESTRATOR_AGENT_ID!;
const ENVIRONMENT_ID = process.env.ENVIRONMENT_ID!;
const VAULT_ID = process.env.VAULT_ID!; // holds GitHub + Jira MCP credentials — see src/setup-vault.ts
const GITHUB_REPO_URL = process.env.GITHUB_REPO_URL!;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN!; // repo clone/push token (separate from the GitHub MCP credential)

export type ConfirmationDecision = { allow: boolean; message?: string };

export type ToolConfirmationRequest = {
  toolUseId: string;
  toolName: string;
  agentName?: string;
  input: unknown;
};

// Engineer (GitHub MCP) and Jira Creator (Jira MCP) are both configured with
// always_ask — every PR and every ticket pauses here until you decide. Wire
// this up to a human reviewer in your game UI; the default below just logs
// and auto-allows so the pipeline is runnable out of the box. Auto-allowing
// silently defeats the point of always_ask, so do not ship that default.
async function defaultOnToolConfirmation(
  req: ToolConfirmationRequest,
): Promise<ConfirmationDecision> {
  console.warn(
    `\n[auto-allowing unreviewed action] ${req.agentName ?? "agent"} wants to call ` +
      `${req.toolName} with input ${JSON.stringify(req.input)}. Pass onToolConfirmation ` +
      `to buildApprovedDesign() to route this to a human reviewer instead.`,
  );
  return { allow: true };
}

export async function buildApprovedDesign(
  designText: string,
  onToolConfirmation: (
    req: ToolConfirmationRequest,
  ) => Promise<ConfirmationDecision> = defaultOnToolConfirmation,
) {
  const session = await client.beta.sessions.create({
    agent: ORCHESTRATOR_AGENT_ID,
    environment_id: ENVIRONMENT_ID,
    title: "Build pipeline session",
    vault_ids: [VAULT_ID],
    resources: [
      {
        type: "github_repository",
        url: GITHUB_REPO_URL,
        authorization_token: GITHUB_TOKEN,
        checkout: { type: "branch", name: "main" },
      },
    ],
  });
  console.log(
    `Watch live: https://platform.claude.com/workspaces/default/sessions/${session.id}`,
  );

  const stream = await client.beta.sessions.events.stream(session.id);

  await client.beta.sessions.events.send(session.id, {
    events: [
      {
        type: "user.message",
        content: [
          {
            type: "text",
            text:
              `Implement this approved system design end to end: plan it, build it, ` +
              `test it, and file Jira tickets for the work.\n\n${designText}`,
          },
        ],
      },
    ],
  });

  const seen = new Set<string>();
  // Tracks pending agent.tool_use / agent.mcp_tool_use events with
  // evaluated_permission === "ask", keyed by event.id (== tool_use_id),
  // so we can resolve them once session.status_idle names them in stop_reason.
  const pendingConfirmations = new Map<
    string,
    { toolName: string; agentName?: string; input: unknown; sessionThreadId?: string }
  >();

  for await (const event of stream) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);

    if (event.type === "agent.message") {
      for (const block of event.content) {
        if (block.type === "text") process.stdout.write(block.text);
      }
    }

    if (
      (event.type === "agent.tool_use" || event.type === "agent.mcp_tool_use") &&
      event.evaluated_permission === "ask"
    ) {
      // The event itself doesn't carry which agent made the call — only the
      // tool/server name. mcp_server_name is the closest available context.
      pendingConfirmations.set(event.id, {
        toolName: event.name,
        agentName: event.type === "agent.mcp_tool_use" ? event.mcp_server_name : undefined,
        input: event.input,
        sessionThreadId: event.session_thread_id ?? undefined,
      });
    }

    if (event.type === "session.status_terminated") break;

    if (event.type === "session.status_idle") {
      if (event.stop_reason.type === "requires_action") {
        const confirmations = [];
        for (const eventId of event.stop_reason.event_ids) {
          const pending = pendingConfirmations.get(eventId);
          if (!pending) continue; // not a tool confirmation (e.g. a custom_tool_result wait)
          pendingConfirmations.delete(eventId);

          const decision = await onToolConfirmation({
            toolUseId: eventId,
            toolName: pending.toolName,
            agentName: pending.agentName,
            input: pending.input,
          });

          confirmations.push({
            type: "user.tool_confirmation" as const,
            tool_use_id: eventId,
            result: decision.allow ? ("allow" as const) : ("deny" as const),
            ...(decision.message ? { deny_message: decision.message } : {}),
            ...(pending.sessionThreadId
              ? { session_thread_id: pending.sessionThreadId }
              : {}),
          });
        }
        if (confirmations.length > 0) {
          await client.beta.sessions.events.send(session.id, { events: confirmations });
        }
        continue;
      }
      break;
    }
  }

  return { sessionId: session.id };
}
