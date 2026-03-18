import { NextRequest, NextResponse } from 'next/server';
import { getSQLiteClient } from '@/services/database/sqlite-client';
import { eventBroadcaster } from '@/services/events';
import { normalizeDimensionName, validateDimensionDescription } from '@/services/database/quality';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const sqlite = getSQLiteClient();

    // Get all dimensions with their counts
    const result = sqlite.query<{ dimension: string; description: string | null; icon: string | null; count: number }>(`
      WITH dimension_counts AS (
        SELECT nd.dimension, COUNT(*) AS count
        FROM node_dimensions nd
        GROUP BY nd.dimension
      )
      SELECT
        d.name AS dimension,
        d.description,
        d.icon,
        COALESCE(dc.count, 0) AS count
      FROM dimensions d
      LEFT JOIN dimension_counts dc ON dc.dimension = d.name
      ORDER BY d.name ASC
    `);

    return NextResponse.json({
      success: true,
      data: result.rows.map((row) => ({
        dimension: row.dimension,
        description: row.description,
        icon: row.icon || null,
        isPriority: false,
        count: Number(row.count)
      }))
    });
  } catch (error) {
    console.error('Error fetching dimensions:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch dimensions'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawName = typeof body?.name === 'string' ? normalizeDimensionName(body.name) : '';
    const description = typeof body?.description === 'string' ? body.description.trim() : null;
    const icon = typeof body?.icon === 'string' ? body.icon.trim() || null : null;
    
    if (!rawName) {
      return NextResponse.json({
        success: false,
        error: 'Dimension name is required'
      }, { status: 400 });
    }

    const descriptionError = validateDimensionDescription(description || '');
    if (descriptionError) {
      return NextResponse.json({
        success: false,
        error: descriptionError
      }, { status: 400 });
    }

    const sqlite = getSQLiteClient();
    const result = sqlite.query<{ name: string; description: string | null; icon: string | null; is_priority: number }>(`
      INSERT INTO dimensions(name, description, icon, is_priority, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET
        description = COALESCE(?, description),
        icon = COALESCE(?, icon),
        updated_at = CURRENT_TIMESTAMP
      RETURNING name, description, icon, is_priority
    `, [rawName, description, icon, 0, description, icon]);

    if (result.rows.length === 0) {
      throw new Error('Failed to create dimension');
    }

    const row = result.rows[0];
    const dimension = row.name as string;
    const descriptionValue = row.description as string | null;
    const iconValue = (row.icon as string | null) || null;

    eventBroadcaster.broadcast({
      type: 'DIMENSION_UPDATED',
      data: { dimension, isPriority: false, description: descriptionValue, icon: iconValue, count: 0 }
    });

    return NextResponse.json({
      success: true,
      data: {
        dimension,
        description: descriptionValue,
        icon: iconValue,
        isPriority: false
      }
    });
  } catch (error) {
    console.error('Error creating dimension:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to create dimension'
    }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const currentName = typeof body?.currentName === 'string' ? normalizeDimensionName(body.currentName) : '';
    const newName = typeof body?.newName === 'string' ? normalizeDimensionName(body.newName) : '';
    const name = typeof body?.name === 'string' ? normalizeDimensionName(body.name) : '';
    const description = typeof body?.description === 'string' ? body.description.trim() : '';
    const icon = body?.icon !== undefined ? (typeof body.icon === 'string' ? body.icon.trim() || null : null) : undefined;
    
    // Handle dimension name change
    if (currentName && newName && currentName !== newName) {
      if (!newName) {
        return NextResponse.json({
          success: false,
          error: 'New dimension name is required'
        }, { status: 400 });
      }

      const sqlite = getSQLiteClient();
      
      // Check if new name already exists
      const existingCheck = sqlite.query(`
        SELECT name FROM dimensions WHERE name = ?
      `, [newName]);

      if (existingCheck.rows.length > 0) {
        return NextResponse.json({
          success: false,
          error: 'A dimension with this name already exists'
        }, { status: 400 });
      }

      // Update dimension name in transaction (also handle description and isPriority if provided)
      const updateResult = sqlite.transaction(() => {
        // Build update query with optional fields
        const updates: string[] = ['name = ?', 'updated_at = CURRENT_TIMESTAMP'];
        const values: unknown[] = [newName];
        
        if (description !== '') {
          updates.push('description = ?');
          values.push(description || null);
        }

        if (icon !== undefined) {
          updates.push('icon = ?');
          values.push(icon);
        }

        values.push(currentName);

        const dimUpdate = sqlite.prepare(`
          UPDATE dimensions
          SET ${updates.join(', ')}
          WHERE name = ?
        `).run(...values);

        // Update node_dimensions table
        const nodeDimUpdate = sqlite.prepare(`
          UPDATE node_dimensions 
          SET dimension = ? 
          WHERE dimension = ?
        `).run(newName, currentName);

        return {
          dimensionUpdated: dimUpdate.changes > 0,
          nodeLinksUpdated: nodeDimUpdate.changes
        };
      });

      if (!updateResult.dimensionUpdated) {
        return NextResponse.json({
          success: false,
          error: 'Dimension not found'
        }, { status: 404 });
      }

      eventBroadcaster.broadcast({
        type: 'DIMENSION_UPDATED',
        data: { 
          dimension: newName, 
          previousName: currentName,
          description: description || undefined,
          isPriority: false,
          renamed: true 
        }
      });

      return NextResponse.json({
        success: true,
        data: {
          dimension: newName,
          previousName: currentName,
          description: description || undefined,
          isPriority: false,
          nodeLinksUpdated: updateResult.nodeLinksUpdated
        }
      });
    }

    // Handle description and/or isPriority update (existing functionality)
    const targetName = name || currentName;
    if (!targetName) {
      return NextResponse.json({
        success: false,
        error: 'Dimension name is required'
      }, { status: 400 });
    }

    if (description) {
      const descriptionError = validateDimensionDescription(description);
      if (descriptionError) {
        return NextResponse.json({
          success: false,
          error: descriptionError
        }, { status: 400 });
      }
    }

    if (description !== '' || icon !== undefined) {
      const sqlite = getSQLiteClient();
      
      // Build update query
      const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
      const values: unknown[] = [];

      if (description !== '') {
        updates.push('description = ?');
        values.push(description || null);
      }

      if (icon !== undefined) {
        updates.push('icon = ?');
        values.push(icon);
      }

      values.push(targetName);

      const updateResult = sqlite.prepare(`
        UPDATE dimensions
        SET ${updates.join(', ')}
        WHERE name = ?
      `).run(...values);

      if (updateResult.changes === 0) {
        return NextResponse.json({
          success: false,
          error: 'Dimension not found'
        }, { status: 404 });
      }
    } else {
      return NextResponse.json({
        success: false,
        error: 'At least one update field (description, icon, or newName) must be provided'
      }, { status: 400 });
    }

    eventBroadcaster.broadcast({
      type: 'DIMENSION_UPDATED',
      data: {
        dimension: targetName,
        description: description !== '' ? description : undefined,
        icon: icon !== undefined ? icon : undefined,
        isPriority: false
      }
    });

    return NextResponse.json({
      success: true,
      data: {
        dimension: targetName,
        description: description !== '' ? description : undefined,
        icon: icon !== undefined ? icon : undefined,
        isPriority: false
      }
    });
  } catch (error) {
    console.error('Error updating dimension:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to update dimension'
    }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const dimension = (request.nextUrl.searchParams.get('name') || '').trim();
    if (!dimension) {
      return NextResponse.json({
        success: false,
        error: 'Dimension name is required'
      }, { status: 400 });
    }

    const sqlite = getSQLiteClient();
    const removal = sqlite.transaction(() => {
      const nodeDimStmt = sqlite.prepare('DELETE FROM node_dimensions WHERE dimension = ?');
      const dimStmt = sqlite.prepare('DELETE FROM dimensions WHERE name = ?');
      const removedLinks = nodeDimStmt.run(dimension).changes ?? 0;
      const removedRow = dimStmt.run(dimension).changes ?? 0;
      return {
        removedLinks,
        removedRow
      };
    });

    if (!removal.removedLinks && !removal.removedRow) {
      return NextResponse.json({
        success: false,
        error: 'Dimension not found'
      }, { status: 404 });
    }

    eventBroadcaster.broadcast({
      type: 'DIMENSION_UPDATED',
      data: { dimension, deleted: true }
    });

    return NextResponse.json({
      success: true,
      data: {
        dimension,
        deleted: true
      }
    });
  } catch (error) {
    console.error('Error deleting dimension:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to delete dimension'
    }, { status: 500 });
  }
}
