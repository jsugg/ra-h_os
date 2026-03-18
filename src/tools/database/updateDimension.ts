import { tool } from 'ai';
import { z } from 'zod';
import { getInternalApiBaseUrl } from '@/services/runtime/apiBase';

export const updateDimensionTool = tool({
  description: 'Update a dimension name or description.',
  inputSchema: z.object({
    currentName: z.string().describe('Current dimension name'),
    newName: z.string().optional().describe('New dimension name (if renaming)'),
    description: z.string().max(500).optional().describe('New description (max 500 characters)')
  }),
  execute: async (params) => {
    console.log('📝 UpdateDimension tool called with params:', JSON.stringify(params, null, 2));
    try {
      // Validate at least one update field
      if (!params.newName && params.description === undefined) {
        return {
          success: false,
          error: 'At least one update field (newName or description) must be provided',
          data: null
        };
      }

      // Handle rename + other updates
      const body: {
        currentName: string;
        description: string;
        newName?: string;
      } = {
        currentName: params.currentName.trim(),
        description: params.description?.trim() || ''
      };
      
      if (params.newName) {
        body.newName = params.newName.trim();
      }

      const response = await fetch(`${getInternalApiBaseUrl()}/api/dimensions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        let errorMessage = 'Failed to update dimension';
        try {
          const errorResult = await response.json();
          errorMessage = errorResult.error || errorMessage;
        } catch {
          // If response is not JSON (e.g., HTML error page), use status text
          errorMessage = `Failed to update dimension: ${response.status} ${response.statusText}`;
        }
        return {
          success: false,
          error: errorMessage,
          data: null
        };
      }

      const result = await response.json();

      const updates = [];
      if (params.newName) updates.push(`renamed to "${params.newName}"`);
      if (params.description !== undefined) updates.push('description updated');

      return {
        success: true,
        data: result.data,
        message: `Updated dimension "${params.currentName}": ${updates.join(', ')}`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update dimension',
        data: null
      };
    }
  }
});
