import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "../mcp-server.js";
import { ToolDefinition } from "../types.js";

const helloWorldTool: ToolDefinition = {
  name: "helloWorld",
  description: "Returns a Hello World greeting.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  annotations: {
    title: "Hello World Tool",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

class HelloWorldMcpServer extends McpServer {
  constructor() {
    super({
      name: "hello-world-server",
      version: "1.0.0",
      toolsetConfig: { mode: "readOnly" },
      capabilities: {
        tools: {
          helloWorld: {
            definitions: helloWorldTool,
            handlers: async () => ({
              content: [
                { type: "text", text: "Hello, World!" },
              ],
            }),
          },
        },
      },
    });
  }
}

async function main() {
  const server = new HelloWorldMcpServer();
  const transport = new StdioServerTransport();
  await server.server.connect(transport);
  console.error("Hello World MCP server running on stdio");
}

main().catch((error) => console.error(error));
