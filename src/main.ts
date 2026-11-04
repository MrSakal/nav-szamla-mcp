#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CONFIG_PATH, ensureConfigFile } from "./config.js";
import { createNavServer } from "./server.js";

// Credentials live in ~/.nav-szamla-mcp/config.json; a blank one is created on first start.
// The file is read again on every tool call, so edits apply without a restart.
try {
  if (ensureConfigFile()) console.error(`nav-szamla-mcp: created ${CONFIG_PATH}, fill it in.`);
  await createNavServer().connect(new StdioServerTransport());
  console.error(`nav-szamla-mcp ready on stdio, config: ${CONFIG_PATH}`);
} catch (err) {
  console.error("nav-szamla-mcp could not start:", err);
  process.exit(1);
}
