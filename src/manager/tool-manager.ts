// ToolManager handles tool logic for McpServer
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  ToolDefinition,
  ToolsetConfig,
  DynamicToolDiscoveryOptions,
  Promisable,
  ToolCapability,
} from "../types";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export class ToolManager {
  private readonly tools: Map<string, ToolCapability> = new Map();
  private enabledTools: Set<string> = new Set();
  private toolsetConfig: ToolsetConfig;
  constructor(
    toolsCapabilities: ToolCapability[],
    toolsetConfig: ToolsetConfig,
    dynamicToolDiscovery?: DynamicToolDiscoveryOptions
  ) {
    this.toolsetConfig = toolsetConfig;
    toolsCapabilities.forEach((capability) => {
      this.tools.set(capability.definition.name, capability);
      this.enabledTools.add(capability.definition.name);
    });
    // Dynamic tool discovery logic
    if (dynamicToolDiscovery?.enabled) {
      // Tool to list available/enabled tools
      this.tools.set("dynamic_tool_list", {
        definition: {
          name: "dynamic_tool_list",
          description: "List, enable, or disable available tools dynamically.",
          inputSchema: z.object({}),
          annotations: {
            title: "Dynamic Tool Discovery",
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        handler: () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  available: Array.from(this.tools.keys()),
                  enabled: Array.from(this.enabledTools),
                },
                null,
                2
              ),
            },
          ],
        }),
      });
      this.enabledTools.add("dynamic_tool_list");
      // Tool to enable/disable toolsets
      this.tools.set("dynamic_tool_trigger", {
        definition: {
          name: "dynamic_tool_trigger",
          description: "Enable or disable multiple toolsets.",
          inputSchema: z.object({
            toolsets: z.array(
              z.object({
                name: z
                  .string()
                  .refine(
                    (name) =>
                      dynamicToolDiscovery.availableToolsets.includes(name),
                    {
                      message: "Invalid toolset name",
                    }
                  ),
                trigger: z.enum(["enable", "disable"]),
              })
            ),
          }),
          annotations: {
            title: "Dynamic Tool Trigger",
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        handler: async (params: any) => {
          const { toolsets } = params;
          for (const { name, trigger } of toolsets) {
            if (trigger === "enable") {
              this.enabledTools.add(name);
            } else if (trigger === "disable") {
              this.enabledTools.delete(name);
            }
          }
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    available: Array.from(this.tools.keys()),
                    enabled: Array.from(this.enabledTools),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        },
      });
      this.enabledTools.add("dynamic_tool_trigger");
      // Optionally enable default toolsets
      if (dynamicToolDiscovery.defaultEnabledToolsets) {
        for (const toolName of dynamicToolDiscovery.defaultEnabledToolsets) {
          if (this.tools.get(toolName)) {
            this.enabledTools.add(toolName);
          }
        }
      }
    }
    console.log(
      `ToolManager initialized with ${Array.from(this.tools).length} tools`
    );
  }
  async listTools() {
    return {
      tools: Array.from(this.tools)
        .filter(([name]) => this.enabledTools.has(name))
        .map(([_, v]) =>
          v.definition.inputSchema
            ? {
                ...v.definition,
                inputSchema: zodToJsonSchema(v.definition.inputSchema, {
                  $refStrategy: "none",
                }),
              }
            : { ...v.definition, inputSchema: zodToJsonSchema(z.object({})) }
        ),
    };
  }
  async callTool(request: any) {
    console.log(request);
    const toolCapability = this.tools.get(request.params.name);
    if (!toolCapability) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`
      );
    }
    if (!this.enabledTools.has(request.params.name)) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Tool not enabled: ${request.params.name}`
      );
    }
    if (!request.params.arguments) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${request.params.arguments}`
      );
    }
    const toolDefinition = toolCapability.definition;
    const inputSchema = toolDefinition.inputSchema;
    const validationResult = inputSchema.safeParse(request.params.arguments);
    if (!validationResult.success) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${validationResult.error}`
      );
    }
    return toolCapability.handler(request.params.arguments);
  }

  hasTools() {
    return this.tools.size > 0;
  }
}
