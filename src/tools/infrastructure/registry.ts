import { getToolGroup, groupTools, getAllToolsByGroup } from './groups';
import { queryNodesTool } from '../database/queryNodes';
import { getNodesByIdTool } from '../database/getNodesById';
import { createNodeTool } from '../database/createNode';
import { updateNodeTool } from '../database/updateNode';
import { createEdgeTool } from '../database/createEdge';
import { queryEdgeTool } from '../database/queryEdge';
import { updateEdgeTool } from '../database/updateEdge';
import { createDimensionTool } from '../database/createDimension';
import { updateDimensionTool } from '../database/updateDimension';
// lockDimension and unlockDimension consolidated into updateDimension (use isPriority param)
import { deleteDimensionTool } from '../database/deleteDimension';
import { queryDimensionsTool } from '../database/queryDimensions';
import { getDimensionTool } from '../database/getDimension';
import { queryDimensionNodesTool } from '../database/queryDimensionNodes';
import { searchContentEmbeddingsTool } from '../other/searchContentEmbeddings';
import { webSearchTool } from '../other/webSearch';
import { thinkTool } from '../other/think';
import { youtubeExtractTool } from '../other/youtubeExtract';
import { websiteExtractTool } from '../other/websiteExtract';
import { paperExtractTool } from '../other/paperExtract';
import { sqliteQueryTool } from '../other/sqliteQuery';
import { logEvalToolCall } from '@/services/evals/evalsLogger';

type RegisteredTool = Record<string, unknown>;

type ExecutableTool = RegisteredTool & {
  schema?: unknown;
  execute: (params: unknown, context: unknown) => Promise<unknown>;
};

// Core tools available to all agents (read-only graph operations)
const CORE_TOOLS: Record<string, RegisteredTool> = {
  sqliteQuery: sqliteQueryTool,
  queryNodes: queryNodesTool,
  getNodesById: getNodesByIdTool,
  queryEdge: queryEdgeTool,
  queryDimensions: queryDimensionsTool,
  getDimension: getDimensionTool,
  queryDimensionNodes: queryDimensionNodesTool,
  searchContentEmbeddings: searchContentEmbeddingsTool,
};

const ORCHESTRATION_TOOLS: Record<string, RegisteredTool> = {
  webSearch: webSearchTool,
  think: thinkTool,
};

// Execution tools for worker agents (includes write operations)
const EXECUTION_TOOLS: Record<string, RegisteredTool> = {
  createNode: createNodeTool,
  updateNode: updateNodeTool,
  createEdge: createEdgeTool,
  updateEdge: updateEdgeTool,
  createDimension: createDimensionTool,
  updateDimension: updateDimensionTool,
  deleteDimension: deleteDimensionTool,
  youtubeExtract: youtubeExtractTool,
  websiteExtract: websiteExtractTool,
  paperExtract: paperExtractTool,
};

export const TOOL_SETS = {
  core: CORE_TOOLS,
  orchestration: ORCHESTRATION_TOOLS,
  execution: EXECUTION_TOOLS,
};

export const TOOLS: Record<string, RegisteredTool> = {
  ...CORE_TOOLS,
  ...ORCHESTRATION_TOOLS,
  ...EXECUTION_TOOLS,
};

const ORCHESTRATOR_TOOL_NAMES = Array.from(new Set([
  ...Object.keys(CORE_TOOLS),
  'webSearch',
  'think',
  'createNode',
  'updateNode',
  'createEdge',
  'updateEdge',
  'createDimension',
  'updateDimension',
  'deleteDimension',
  'youtubeExtract',
  'websiteExtract',
  'paperExtract',
]));

const EXECUTOR_TOOL_NAMES = [
  ...Object.keys(CORE_TOOLS),
  ...Object.keys(ORCHESTRATION_TOOLS),
  ...Object.keys(EXECUTION_TOOLS),
];

// Note: PLANNER_TOOL_NAMES kept for backwards compatibility but workflows now use specific tool sets
const PLANNER_TOOL_NAMES = [
  ...Object.keys(CORE_TOOLS),
  'webSearch',
  'think',
  'updateNode',
  'createEdge',
  'updateDimension',
];

/**
 * Get tool by ID
 */
export function getTool(toolId: string): RegisteredTool | null {
  return TOOLS[toolId] || null;
}

/**
 * Get tools by IDs (for helper's available_tools)
 */
export function getTools(toolIds: string[]): RegisteredTool[] {
  if (!Array.isArray(toolIds)) {
    console.error('getTools received non-array:', toolIds);
    return [];
  }
  return toolIds.map(id => TOOLS[id]).filter(Boolean);
}

/**
 * Get all available tools
 */
export function getAllTools(): RegisteredTool[] {
  return Object.values(TOOLS);
}

/**
 * Get tool schemas for OpenAI function calling
 */
export function getToolSchemas(toolIds: string[]) {
  return getTools(toolIds).map(tool => tool.schema);
}

/**
 * Get tools for a specific helper by tool names
 * This is the main function used by helper APIs to get their assigned tools
 */
export function getHelperTools(availableToolNames: string[]): Record<string, RegisteredTool> {
  if (!Array.isArray(availableToolNames)) {
    console.error('getHelperTools received non-array:', availableToolNames);
    return {};
  }
  
  return availableToolNames.reduce((tools, name) => {
    if (TOOLS[name]) {
      tools[name] = wrapToolForEvalLogging(name, TOOLS[name]);
    } else {
      console.warn(`Tool '${name}' not found in registry`);
    }
    return tools;
  }, {} as Record<string, RegisteredTool>);
}

export function getDefaultToolNamesForRole(role: 'orchestrator' | 'executor' | 'planner'): string[] {
  if (role === 'orchestrator') {
    return [...ORCHESTRATOR_TOOL_NAMES];
  }
  if (role === 'planner') {
    return [...PLANNER_TOOL_NAMES];
  }
  return [...EXECUTOR_TOOL_NAMES];
}

export function getToolsForRole(role: 'orchestrator' | 'executor' | 'planner'): Record<string, RegisteredTool> {
  const names = getDefaultToolNamesForRole(role);
  return getHelperTools(names);
}

/**
 * Get tools by their names (for workflow execution with specific tool sets)
 */
export function getToolsByNames(toolNames: string[]): Record<string, RegisteredTool> {
  if (!Array.isArray(toolNames) || toolNames.length === 0) {
    console.warn('[getToolsByNames] No tool names provided');
    return {};
  }
  return getHelperTools(toolNames);
}

/**
 * Execute a tool with given parameters and context
 */
export async function executeTool(toolId: string, params: unknown, context: unknown) {
  const tool = getTool(toolId);
  
  if (!tool || typeof tool.execute !== 'function') {
    return {
      success: false,
      error: `Tool '${toolId}' not found`,
      data: null
    };
  }
  
  const startedAt = Date.now();
  try {
    const executableTool = tool as ExecutableTool;
    const result = await executableTool.execute(params, context);
    logEvalToolCall({
      toolName: toolId,
      args: params,
      result,
      latencyMs: Date.now() - startedAt
    });
    return result;
  } catch (error) {
    logEvalToolCall({
      toolName: toolId,
      args: params,
      error,
      latencyMs: Date.now() - startedAt
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : `Tool '${toolId}' execution failed`,
      data: null
    };
  }
}

function wrapToolForEvalLogging(toolName: string, tool: RegisteredTool): RegisteredTool {
  if (!tool || typeof tool.execute !== 'function') {
    return tool;
  }

  const executableTool = tool as ExecutableTool;

  return {
    ...tool,
    execute: async (params: unknown, context: unknown) => {
      const startedAt = Date.now();
      try {
        const result = await executableTool.execute(params, context);
        logEvalToolCall({
          toolName,
          args: params,
          result,
          latencyMs: Date.now() - startedAt
        });
        return result;
      } catch (error) {
        logEvalToolCall({
          toolName,
          args: params,
          error,
          latencyMs: Date.now() - startedAt
        });
        throw error;
      }
    }
  };
}

// Export group utilities
export { getToolGroup, groupTools, getAllToolsByGroup };
