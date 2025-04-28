import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "./mcp-server.js";

async function main() {
  const server = new McpServer({
    name: "hello-world-server",
    version: "1.0.0",
    toolsetConfig: { mode: "readOnly" },
    capabilities: {},
  });
  const transport = new StdioServerTransport();
  await server.server.connect(transport);
  console.error("MCP server running on stdio");
}

main().catch((error) => console.error(error));
