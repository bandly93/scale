// ONE-TIME HELPER — runs the Atlassian OAuth 2.0 (3LO) authorization-code flow
// locally and prints the access/refresh tokens to paste into .env
// (JIRA_MCP_ACCESS_TOKEN) and to use in setup-vault.ts's refresh block.
//
// Prereqs: an OAuth 2.0 integration created at
// https://developer.atlassian.com/console/myapps/ with callback URL
// http://localhost:8765/callback and ATLASSIAN_CLIENT_ID / ATLASSIAN_CLIENT_SECRET
// set in .env.
import { createServer } from "http";
import { exec } from "child_process";

const CLIENT_ID = process.env.ATLASSIAN_CLIENT_ID!;
const CLIENT_SECRET = process.env.ATLASSIAN_CLIENT_SECRET!;
const REDIRECT_URI = "http://localhost:8765/callback";
const SCOPES = [
  "read:jira-work",
  "read:jira-user",
  "write:jira-work",
  "read:me",
  "offline_access",
].join(" ");

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set ATLASSIAN_CLIENT_ID and ATLASSIAN_CLIENT_SECRET in .env first.");
  process.exit(1);
}

const authorizeUrl =
  `https://auth.atlassian.com/authorize?audience=api.atlassian.com` +
  `&client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code&prompt=consent`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, REDIRECT_URI);
  if (url.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("Missing code");
    return;
  }
  res.writeHead(200, { "content-type": "text/html" }).end(
    "<h1>Authorized</h1>You can close this tab and return to the terminal.",
  );
  server.close();

  const tokenResp = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!tokenResp.ok) {
    console.error("Token exchange failed:", tokenResp.status, await tokenResp.text());
    process.exit(1);
  }

  const tokens = (await tokenResp.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  console.log("\nJIRA_MCP_ACCESS_TOKEN=" + tokens.access_token);
  console.log("ATLASSIAN_REFRESH_TOKEN=" + tokens.refresh_token);
  console.log(`(access token expires in ${tokens.expires_in}s; refresh token lets setup-vault.ts auto-renew it)`);
});

server.listen(8765, () => {
  console.log("Opening browser for Atlassian authorization...");
  console.log(authorizeUrl);
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${opener} "${authorizeUrl}"`);
});
