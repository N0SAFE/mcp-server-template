import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "../mcp-server";
import * as z from "zod";
import { createTool, createToolDefinition } from "../utils/tools";
import { ToolCapability } from "types";

const helloWorldTool = createToolDefinition({
  name: "hello_world",
  description: "Returns a Hello World greeting.",
  inputSchema: z.object({
    name: z
      .string()
      .optional()
      .describe('provide a optional name to replace "World"'),
  }),
  annotations: {
    title: "Hello World Tool",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
});

class HelloWorldMcpServer extends McpServer {
  constructor() {
    super({
      name: "hello-world-server",
      version: "1.0.0",
      toolsetConfig: { mode: "readOnly" },
      capabilities: {
        tools: [
          createTool(helloWorldTool, async ({ name }) => {
            return {
              content: [
                {
                  type: "text",
                  text: `Hello ${name || "World"}!`,
                },
              ],
            };
          }),
        ],
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
