import { getSQLiteClient } from './sqlite-client';

export interface Dimension {
  name: string;
  description: string | null;
  is_priority: boolean;
  updated_at: string;
}

export interface LockedDimension {
  name: string;
  description: string | null;
  count: number;
}

export class DimensionService {
  /**
   * Legacy compatibility shim. Dimensions are now flat, so there is no locked subset.
   */
  static async getLockedDimensions(): Promise<LockedDimension[]> {
    return [];
  }

  /**
   * Automatic special-dimension assignment has been removed. Callers must provide dimensions explicitly.
   */
  static async assignDimensions(nodeData: {
    title: string;
    content?: string;
    link?: string;
    description?: string;
  }): Promise<{ locked: string[]; keywords: string[] }> {
    console.log(`[DimensionAssignment] Skipped for "${nodeData.title}" — flat dimensions require explicit assignment.`);
    return { locked: [], keywords: [] };
  }

  /**
   * Legacy method for backwards compatibility
   * @deprecated Use assignDimensions() instead
   */
  static async assignLockedDimensions(nodeData: {
    title: string;
    content?: string;
    link?: string;
  }): Promise<string[]> {
    const result = await this.assignDimensions(nodeData);
    return result.locked;
  }

  /**
   * Update dimension description
   */
  static async updateDimensionDescription(name: string, description: string): Promise<void> {
    const sqlite = getSQLiteClient();
    
    sqlite.query(`
      INSERT INTO dimensions(name, description, is_priority, updated_at) 
      VALUES (?, ?, 0, CURRENT_TIMESTAMP) 
      ON CONFLICT(name) DO UPDATE SET 
        description = ?, 
        updated_at = CURRENT_TIMESTAMP
    `, [name, description, description]);
  }

  /**
   * Get dimension by name with description
   */
  static async getDimensionByName(name: string): Promise<Dimension | null> {
    const sqlite = getSQLiteClient();
    
    const result = sqlite.query(`
      SELECT name, description, is_priority, updated_at 
      FROM dimensions 
      WHERE name = ?
    `, [name]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0] as Dimension;
    return {
      name: row.name,
      description: row.description,
      is_priority: Boolean(row.is_priority),
      updated_at: row.updated_at
    };
  }

  /**
   * Legacy no-op prompt builder retained only for backward compatibility.
   */
  private static buildAssignmentPrompt(
    nodeData: { title: string; notes?: string; link?: string; description?: string },
    lockedDimensions: LockedDimension[]
  ): string {
    // Use description as primary context, content as fallback
    let nodeContextSection: string;
    if (nodeData.description) {
      const notesPreview = nodeData.notes?.slice(0, 500) || '';
      nodeContextSection = `DESCRIPTION: ${nodeData.description}

NOTES PREVIEW: ${notesPreview}${nodeData.notes && nodeData.notes.length > 500 ? '...' : ''}`;
    } else {
      const notesPreview = nodeData.notes?.slice(0, 2000) || '';
      nodeContextSection = `NOTES: ${notesPreview}${nodeData.notes && nodeData.notes.length > 2000 ? '...' : ''}`;
    }

    // Include ALL locked dimensions, using fallback text for those without descriptions
    const dimensionsList = lockedDimensions
      .map(d => {
        const description = d.description && d.description.trim().length > 0
          ? d.description
          : '(none - infer from name)';
        return `DIMENSION: "${d.name}"\nDESCRIPTION: ${description}`;
      })
      .join('\n---\n');

    return `Dimensions are now flat categories with no locked subset.

=== NODE TO CATEGORIZE ===
Title: ${nodeData.title}
${nodeContextSection}
URL: ${nodeData.link || 'none'}

=== LOCKED DIMENSIONS ===
CRITICAL: Read each dimension's DESCRIPTION carefully.
The description defines what belongs in that dimension.
Only assign if the content CLEARLY matches the description.
If unsure, skip it — better to miss than assign incorrectly.

AVAILABLE DIMENSIONS:
${dimensionsList}

=== RESPONSE FORMAT ===
LOCKED:
[dimension names from the list above, one per line, or "none"]`;
  }

  /**
   * Legacy no-op parser retained only for backward compatibility.
   */
  private static parseAssignmentResponse(
    response: string,
    availableDimensions: LockedDimension[]
  ): { locked: string[]; keywords: string[] } {
    const lockedDimensions: string[] = [];

    // Extract LOCKED section
    const lockedMatch = response.match(/LOCKED:\s*([\s\S]*?)$/i);

    if (lockedMatch) {
      const lockedLines = lockedMatch[1].trim().split('\n');
      for (const line of lockedLines) {
        const dimensionName = line.trim().toLowerCase();

        if (dimensionName === 'none' || dimensionName === '') {
          continue;
        }

        // Find matching dimension (case-insensitive)
        const matchedDimension = availableDimensions.find(
          d => d.name.toLowerCase() === dimensionName
        );

        if (matchedDimension && !lockedDimensions.includes(matchedDimension.name)) {
          lockedDimensions.push(matchedDimension.name);
        }
      }
    }

    return { locked: lockedDimensions, keywords: [] };
  }

  /**
   * Create or get a keyword dimension (unlocked)
   */
  static async ensureKeywordDimension(keyword: string): Promise<void> {
    const sqlite = getSQLiteClient();

    // INSERT OR IGNORE - if dimension exists, do nothing
    sqlite.query(`
      INSERT OR IGNORE INTO dimensions(name, description, is_priority, updated_at)
      VALUES (?, ?, 0, CURRENT_TIMESTAMP)
    `, [keyword, null]);
  }
}

export const dimensionService = new DimensionService();
