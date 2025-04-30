import { describe, it, expect, beforeEach } from "vitest";
import { ToolManager } from "../manager/tool-manager";
import { ToolDefinition, DynamicToolDiscoveryOptions } from "../types";
import { z } from "zod";
import { createTool, createToolDefinition } from "../utils/tools";

describe("ToolManager (dynamic tool discovery)", () => {
  let toolManager: ToolManager;
  const toolDef = createToolDefinition({
    name: "testTool",
    description: "A test tool",
    inputSchema: z.object({}),
  });
  const anotherToolDef = createToolDefinition({
    name: "anotherTool",
    description: "Another test tool",
    inputSchema: z.object({}),
  });
  const dynamicOptions = {
    enabled: true,
    defaultEnabledToolsets: [],
  } satisfies DynamicToolDiscoveryOptions;
  beforeEach(() => {
    toolManager = new ToolManager(
      "test_mcp",
      [
        createTool(toolDef, async () => ({
          content: [{ type: "text", text: "ok" }],
        })),
        createTool(anotherToolDef, async () => ({
          content: [{ type: "text", text: "another" }],
        })),
      ],
      { mode: "readOnly" },
      dynamicOptions
    );
  });
  it("should include test_mcp_dynamic_tool_list", async () => {
    const result = await toolManager.listTools();
    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain("test_mcp__dynamic_tool_list");
    expect(toolNames).toContain("test_mcp__dynamic_tool_trigger");
  });
  it("should list available and enabled tools via dynamic_tool_list", async () => {
    const result = await toolManager.callTool({
      params: { name: "test_mcp__dynamic_tool_list", arguments: {} },
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.available.map((a) => a.name)).toContain("test_mcp__testTool");
  });
  it("should enable and disable a tool via dynamic_tool_trigger", async () => {
    // Disable testTool
    await toolManager.callTool({
      params: {
        name: "test_mcp__dynamic_tool_trigger",
        arguments: { toolsets: [{ name: "test_mcp__testTool", trigger: "disable" }] },
      },
    });
    let result = await toolManager.listTools();
    let toolNames = result.tools.map((t) => t.name);
    expect(toolNames).not.toContain("test_mcp__testTool");
    // Enable testTool
    await toolManager.callTool({
      params: {
        name: "test_mcp__dynamic_tool_trigger",
        arguments: { toolsets: [{ name: "test_mcp__testTool", trigger: "enable" }] },
      },
    });
    result = await toolManager.listTools();
    toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain("test_mcp__testTool");
  });
  it("should enable and disable multiple tools in one request via dynamic_tool_trigger", async () => {
    // Disable both tools in one request
    const disableResult = await toolManager.callTool({
      params: {
        name: "test_mcp__dynamic_tool_trigger",
        arguments: {
          toolsets: [
            { name: "test_mcp__testTool", trigger: "disable" },
            { name: "test_mcp__anotherTool", trigger: "disable" },
          ],
        },
      },
    });
    let result = await toolManager.listTools();
    let toolNames = result.tools.map((t) => t.name);
    expect(toolNames).not.toContain("test_mcp__testTool");
    expect(toolNames).not.toContain("test_mcp__anotherTool");
    // Check return value after disabling
    const disabledParsed = JSON.parse(disableResult.content[0].text);
    expect(disabledParsed.enabled.map((a) => a.name)).not.toContain("test_mcp__testTool");
    expect(disabledParsed.enabled.map((a) => a.name)).not.toContain("test_mcp__anotherTool");
    // Enable both tools in one request
    const enableResult = await toolManager.callTool({
      params: {
        name: "test_mcp__dynamic_tool_trigger",
        arguments: {
          toolsets: [
            { name: "test_mcp__testTool", trigger: "enable" },
            { name: "test_mcp__anotherTool", trigger: "enable" },
          ],
        },
      },
    });
    result = await toolManager.listTools();
    toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain("test_mcp__testTool");
    expect(toolNames).toContain("test_mcp__anotherTool");
    // Check return value after enabling
    const enabledParsed = JSON.parse(enableResult.content[0].text);
    expect(enabledParsed.enabled.map((a) => a.name)).toContain("test_mcp__testTool");
    expect(enabledParsed.enabled.map((a) => a.name)).toContain("test_mcp__anotherTool");
  });

  it("should call notifyEnabledToolsChanged and trigger subscriptions", async () => {
    let called = false;
    const callback = (tools) => {
      called = true;
      expect(Array.isArray(tools.tools)).toBe(true);
    };
    toolManager.onEnabledToolsChanged(callback);
    // Trigger a change
    await toolManager.callTool({
      params: {
        name: "test_mcp__dynamic_tool_trigger",
        arguments: { toolsets: [{ name: "test_mcp__testTool", trigger: "disable" }] },
      },
    });
    expect(called).toBe(true);
    toolManager.offEnabledToolsChanged(callback);
    called = false;
    // Should not call after off
    await toolManager.callTool({
      params: {
        name: "test_mcp__dynamic_tool_trigger",
        arguments: { toolsets: [{ name: "test_mcp__testTool", trigger: "enable" }] },
      },
    });
    expect(called).toBe(false);
  });
});
