import { describe, it, expect, beforeEach } from 'vitest';
import { ToolManager } from '../manager/tool-manager.js';
import { createTool } from '../utils/tools';
import { z } from 'zod';

describe('ToolManager', () => {
  let toolManager: ToolManager;
  const toolDef = {
    name: 'testTool',
    description: 'A test tool',
    inputSchema: z.object({}),
  };
  beforeEach(() => {
    toolManager = new ToolManager(
      'test_mcp',
      [
        createTool(toolDef, async () => ({ content: [{ type: 'text', text: 'ok' }] })),
      ],
      { mode: 'readOnly' }
    );
  });
  it('lists enabled tools', async () => {
    const result = await toolManager.listTools();
    expect(result.tools.length).toBe(1);
    expect(result.tools[0].name).toBe('test_mcp__testTool');
  });
  it('calls enabled tool', async () => {
    const result = await toolManager.callTool({ params: { name: 'test_mcp__testTool', arguments: {} } });
    expect(result.content[0].text).toBe('ok');
  });
  it('throws for disabled tool', async () => {
    toolManager['enabledTools'].delete('testTool');
    await expect(toolManager.callTool({ params: { name: 'test_mcp__testTool', arguments: {} } })).rejects.toThrow();
  });
});
