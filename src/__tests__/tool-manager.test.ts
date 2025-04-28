import { describe, it, expect, beforeEach } from 'vitest';
import { ToolManager } from '../manager/tool-manager.js';
import { ToolDefinition } from '../types.js';

describe('ToolManager', () => {
  let toolManager: ToolManager;
  const toolDef: ToolDefinition = {
    name: 'testTool',
    description: 'A test tool',
    inputSchema: { type: 'object', properties: {}, required: [] },
  };
  beforeEach(() => {
    toolManager = new ToolManager(
      {
        testTool: {
          definitions: toolDef,
          handlers: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
        },
      },
      { mode: 'readOnly' }
    );
  });
  it('lists enabled tools', async () => {
    const result = await toolManager.listTools();
    expect(result.tools.length).toBe(1);
    expect(result.tools[0].name).toBe('testTool');
  });
  it('calls enabled tool', async () => {
    const result = await toolManager.callTool({ params: { name: 'testTool', arguments: {} } });
    expect(result.content[0].text).toBe('ok');
  });
  it('throws for disabled tool', async () => {
    toolManager['enabledTools'].delete('testTool');
    await expect(toolManager.callTool({ params: { name: 'testTool', arguments: {} } })).rejects.toThrow();
  });
});
