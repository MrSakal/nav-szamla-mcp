import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { NavApi, NavUnreachable } from "../nav/client.js";
import type { NavReply } from "../nav/types.js";
import { loadSettings, type SettingsSource } from "../config.js";

/** Renders a NAV reply as one status line, the IDs worth keeping, and the payload as JSON. */
export function render(env: string, reply: NavReply): CallToolResult {
  const status = [reply.funcCode, reply.errorCode].filter(Boolean).join(" / ");
  const lines = [`NAV ${env}: ${status}`];
  if (reply.message) lines.push(`Message: ${reply.message}`);
  const transactionId = reply.payload.transactionId;
  if (typeof transactionId === "string") lines.push(`Transaction ID: ${transactionId}`);
  lines.push(`Request ID: ${reply.requestId}`);

  const data: Record<string, unknown> = { ...reply.payload };
  if (reply.notifications) data.notifications = reply.notifications;
  if (Object.keys(data).length > 0) lines.push("", JSON.stringify(data, null, 2));

  return { content: [{ type: "text", text: lines.join("\n") }], isError: !reply.ok };
}

/**
 * Runs one tool call: loads settings (so a missing or incomplete config.json is reported per call, not at startup),
 * calls NAV and turns every failure into an MCP error result instead of a thrown exception.
 */
export async function withNav(
  source: SettingsSource,
  action: (api: NavApi) => Promise<NavReply>
): Promise<CallToolResult> {
  let env = "?";
  try {
    const api = new NavApi(loadSettings(source));
    env = api.env;
    return render(env, await action(api));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const request = err instanceof NavUnreachable ? `\nRequest ID: ${err.requestId}` : "";
    return { content: [{ type: "text", text: `NAV ${env}: failed\n${message}${request}` }], isError: true };
  }
}
