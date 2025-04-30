#!/usr/bin/env node

import { MainMcpServer } from "index";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import { getConfigFromCommanderAndEnv } from "./config";

async function main() {
  const server = new MainMcpServer(getConfigFromCommanderAndEnv());
  const transport = new StdioServerTransport();
  await server.server.connect(transport);
  console.log("MCP server running on stdio (CLI mode)");
}

main().catch((err) => {
  console.error("Failed to start MCP server:", err);
  process.exit(1);
});
