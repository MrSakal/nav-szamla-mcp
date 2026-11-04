import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { APP_NAME, APP_VERSION, type SettingsSource } from "./config.js";
import { registerReadTools } from "./tools/read-tools.js";
import { registerWriteTools } from "./tools/write-tools.js";
import { registerPrompts } from "./prompts.js";

/**
 * Creates the MCP server. Tests pass a config directly; the stdio entry point passes nothing, so
 * ~/.nav-szamla-mcp/config.json is read at the time of each tool call.
 */
export function createNavServer(source?: SettingsSource): McpServer {
  const server = new McpServer(
    { name: APP_NAME, version: APP_VERSION },
    {
      instructions:
        "Tools for the Hungarian NAV Online Számla API v3.0. Read tools (nav_get_*, nav_search_invoices, " +
        "nav_list_transactions, nav_invoice_exists) are safe. nav_submit_invoices and nav_annul_invoices send " +
        "data to NAV; ask the user before calling them. Every answer starts with the NAV environment (test/production).",
    }
  );
  registerReadTools(server, source);
  registerWriteTools(server, source);
  registerPrompts(server);
  return server;
}
