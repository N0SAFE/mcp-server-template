// ToolManager handles tool logic for McpServer
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  ToolDefinition,
  ToolsetConfig,
  DynamicToolDiscoveryOptions,
  ToolCapability,
} from "../types";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export type ToolListResponse = {
  tools: (Omit<ToolDefinition, "inputSchema"> & {
    inputSchema: any;
  })[];
};

export class ToolManager {
  private readonly tools: Map<string, ToolCapability> = new Map();
  private enabledTools: Set<string> = new Set();
  private enabledToolSubscriptions: Set<
    (tools: ToolListResponse) => void
  > = new Set();
  private toolsetConfig: ToolsetConfig;
  constructor(
    toolsCapabilities: ToolCapability[],
    toolsetConfig: ToolsetConfig,
    dynamicToolDiscovery?: DynamicToolDiscoveryOptions
  ) {
    this.toolsetConfig = toolsetConfig;
    toolsCapabilities.forEach((capability) => {
      this.tools.set(capability.definition.name, capability);
    });
    if (dynamicToolDiscovery?.enabled) {
      dynamicToolDiscovery.defaultEnabledToolsets?.forEach((toolName) => {
        if (this.tools.get(toolName)) {
          this.enabledTools.add(toolName);
        }
      });
    } else {
      this.tools.forEach((_, name) => {
        if (this.toolsetConfig.mode === "readOnly") {
          this.enabledTools.add(name);
        }
      });
    }
    // Dynamic tool discovery logic
    if (dynamicToolDiscovery?.enabled) {
      const dynamicToolDiscoverySuffix = dynamicToolDiscovery.name.replace(
        /[^a-zA-Z0-9]/g, '_'
      );
      const dynamicToolListName = `${dynamicToolDiscoverySuffix}_dynamic_tool_list`;
      const dynamicToolTriggerName = `${dynamicToolDiscoverySuffix}_dynamic_tool_trigger`;
      // Tool to list available/enabled tools
      this.tools.set(dynamicToolListName, {
        definition: {
          name: dynamicToolListName,
          description: "List, enable, or disable available tools dynamically.",
          inputSchema: z.object({}),
          annotations: {
            title: `[${dynamicToolDiscovery.name}] Dynamic Tool Discovery`,
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
      this.enabledTools.add(dynamicToolListName);
      // Tool to enable/disable toolsets
      this.tools.set(dynamicToolTriggerName, {
        definition: {
          name: dynamicToolTriggerName,
          description: "Enable or disable multiple toolsets.",
          inputSchema: z.object({
            toolsets: z.array(
              z.object({
                name: z
                  .string()
                  .refine(
                    (name) =>
                      this.tools.has(name) &&
                      this.tools.get(name)?.definition.name === name,
                    {
                      message: "Invalid toolset name",
                    }
                  ),
                trigger: z.enum(["enable", "disable"]),
              })
            ),
          }),
          annotations: {
            title: `[${dynamicToolDiscovery.name}] Dynamic Tool Trigger`,
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
          await this.notifyEnabledToolsChanged();
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
      this.enabledTools.add(dynamicToolTriggerName);
    }
    console.log(
      `ToolManager initialized with ${Array.from(this.tools).length} tools`
    );
  }
  listTools(): ToolListResponse {
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

  private notifyEnabledToolsChanged() {
    const tools = this.listTools();
    for (const callback of this.enabledToolSubscriptions) {
      callback(tools);
    }
  }

  onEnabledToolsChanged(callback: (tools: ToolListResponse) => void): void {
    this.enabledToolSubscriptions.add(callback);
  }
  offEnabledToolsChanged(callback: (tools: ToolListResponse) => void): void {
    this.enabledToolSubscriptions.delete(callback);
  }

  hasTools() {
    return this.tools.size > 0;
  }
}
