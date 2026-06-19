// ONE-TIME SETUP — run after setup.ts, once you have OAuth credentials for the
// GitHub and Jira MCP servers. Fill in the access/refresh tokens below before running.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

async function main() {
  const vault = await client.beta.vaults.create({ display_name: "sysdesign-game-vault" });
  console.log(`VAULT_ID=${vault.id}`);

  // GitHub MCP credential — get an OAuth token via GitHub's MCP OAuth flow.
  await client.beta.vaults.credentials.create(vault.id, {
    display_name: "GitHub MCP",
    auth: {
      type: "mcp_oauth",
      mcp_server_url: "https://api.githubcopilot.com/mcp/",
      access_token: process.env.GITHUB_MCP_ACCESS_TOKEN!,
      // Omit `refresh` if you only have a non-refreshable access token.
    },
  });

  // Jira MCP credential — minted via `npm run get-jira-token` (src/get-jira-token.ts).
  // PLACEHOLDER — confirm the actual MCP server URL with your org before use
  // (must match the url in configs/jira-manager.agent.yaml exactly).
  await client.beta.vaults.credentials.create(vault.id, {
    display_name: "Jira MCP",
    auth: {
      type: "mcp_oauth",
      mcp_server_url: "https://mcp.atlassian.com/v1/mcp",
      access_token: process.env.JIRA_MCP_ACCESS_TOKEN!,
      refresh: {
        refresh_token: process.env.ATLASSIAN_REFRESH_TOKEN!,
        client_id: process.env.ATLASSIAN_CLIENT_ID!,
        token_endpoint: "https://auth.atlassian.com/oauth/token",
        token_endpoint_auth: {
          type: "client_secret_post",
          client_secret: process.env.ATLASSIAN_CLIENT_SECRET!,
        },
      },
    },
  });

  console.log("Save VAULT_ID into your .env file.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
