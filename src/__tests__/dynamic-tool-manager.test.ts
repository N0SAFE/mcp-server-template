import { describe, it, expect, beforeEach } from 'vitest';
import { ToolManager } from '../manager/tool-manager.js';
import { ToolDefinition, DynamicToolDiscoveryOptions } from '../types.js';

describe('ToolManager (dynamic tool discovery)', () => {
  let toolManager: ToolManager;
  const toolDef: ToolDefinition = {
    name: 'testTool',
    description: 'A test tool',
    inputSchema: { type: 'object', properties: {}, required: [] },
  };
  const dynamicOptions: DynamicToolDiscoveryOptions = {
    enabled: true,
    availableToolsets: ['testTool'],
    defaultEnabledToolsets: [],
  };
  beforeEach(() => {
    toolManager = new ToolManager(
      {
        testTool: {
          definitions: toolDef,
          handlers: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
        },
      },
      { mode: 'readOnly' },
      dynamicOptions
    );
  });
  it('should include dynamic_tool_list and dynamic_tool_trigger', async () => {
    const result = await toolManager.listTools();
    const toolNames = result.tools.map(t => t.name);
    expect(toolNames).toContain('dynamic_tool_list');
    expect(toolNames).toContain('dynamic_tool_trigger');
  });
  it('should list available and enabled tools via dynamic_tool_list', async () => {
    const result = await toolManager.callTool({ params: { name: 'dynamic_tool_list', arguments: {} } });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.available).toContain('testTool');
    expect(parsed.enabled).toContain('dynamic_tool_list');
  });
  it('should enable and disable a tool via dynamic_tool_trigger', async () => {
    // Disable testTool
    await toolManager.callTool({ params: { name: 'dynamic_tool_trigger', arguments: { toolsets: [{ name: 'testTool', trigger: 'disable' }] } } });
    let result = await toolManager.listTools();
    let toolNames = result.tools.map(t => t.name);
    expect(toolNames).not.toContain('testTool');
    // Enable testTool
    await toolManager.callTool({ params: { name: 'dynamic_tool_trigger', arguments: { toolsets: [{ name: 'testTool', trigger: 'enable' }] } } });
    result = await toolManager.listTools();
    toolNames = result.tools.map(t => t.name);
    expect(toolNames).toContain('testTool');
  });
  it('should enable and disable multiple tools in one request via dynamic_tool_trigger', async () => {
    // Add another tool to the manager
    toolManager['tools']['anotherTool'] = {
      definitions: {
        name: 'anotherTool',
        description: 'Another test tool',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      handlers: async () => ({ content: [{ type: 'text', text: 'another' }] }),
    };
    toolManager['enabledTools'].add('anotherTool');
    // Disable both tools in one request
    const disableResult = await toolManager.callTool({
      params: {
        name: 'dynamic_tool_trigger',
        arguments: {
          toolsets: [
            { name: 'testTool', trigger: 'disable' },
            { name: 'anotherTool', trigger: 'disable' },
          ],
        },
      },
    });
    let result = await toolManager.listTools();
    let toolNames = result.tools.map(t => t.name);
    expect(toolNames).not.toContain('testTool');
    expect(toolNames).not.toContain('anotherTool');
    // Check return value after disabling
    const disabledParsed = JSON.parse(disableResult.content[0].text);
    expect(disabledParsed.enabled).not.toContain('testTool');
    expect(disabledParsed.enabled).not.toContain('anotherTool');
    // Enable both tools in one request
    const enableResult = await toolManager.callTool({
      params: {
        name: 'dynamic_tool_trigger',
        arguments: {
          toolsets: [
            { name: 'testTool', trigger: 'enable' },
            { name: 'anotherTool', trigger: 'enable' },
          ],
        },
      },
    });
    result = await toolManager.listTools();
    toolNames = result.tools.map(t => t.name);
    expect(toolNames).toContain('testTool');
    expect(toolNames).toContain('anotherTool');
    // Check return value after enabling
    const enabledParsed = JSON.parse(enableResult.content[0].text);
    expect(enabledParsed.enabled).toContain('testTool');
    expect(enabledParsed.enabled).toContain('anotherTool');
  });
});
