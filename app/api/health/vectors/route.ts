import { NextResponse } from 'next/server';
import { getSQLiteClient } from '@/services/database/sqlite-client';
import { chunkService } from '@/services/database/chunks';

interface ChunkStats {
  total_chunks: number;
  vectorized_chunks: number;
  missing_embeddings: number;
  coverage_percentage: number;
}

interface VectorStatsHealthy {
  vec_chunks_count: number;
  matches_chunk_embeddings: boolean;
}

interface VectorStatsError {
  error: string;
  suggestion: string;
}

type VectorStats = VectorStatsHealthy | VectorStatsError | null;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET() {
  try {
    const sqlite = getSQLiteClient();
    
    // Test basic database connection
    const connectionTest = await sqlite.testConnection();
    if (!connectionTest) {
      return NextResponse.json({
        status: 'error',
        message: 'Database connection failed',
        details: null
      });
    }

    // Check if vector extension is loaded
    const vectorExtensionTest = await sqlite.checkVectorExtension();
    
    let vectorStats = null;
    let chunkStats = null;
    let vectorHealth = 'unknown';

    try {
      // Get chunk counts
      const totalChunks = await chunkService.getChunkCount();
      const chunksWithoutEmbeddings = await chunkService.getChunksWithoutEmbeddings();
      const vectorizedCount = totalChunks - chunksWithoutEmbeddings.length;

      chunkStats = {
        total_chunks: totalChunks,
        vectorized_chunks: vectorizedCount,
        missing_embeddings: chunksWithoutEmbeddings.length,
        coverage_percentage: totalChunks > 0 ? Math.round((vectorizedCount / totalChunks) * 100) : 0
      };

      // Test vector table health by attempting a simple query
      if (vectorExtensionTest) {
        try {
          const result = sqlite.query<{ count: number }>('SELECT COUNT(*) as count FROM vec_chunks');
          const vecCount = Number(result.rows[0].count);
          
          vectorStats = {
            vec_chunks_count: vecCount,
            matches_chunk_embeddings: vecCount === vectorizedCount
          };
          
          vectorHealth = vecCount === vectorizedCount ? 'healthy' : 'inconsistent';
        } catch (vecError: unknown) {
          vectorHealth = 'corrupted';
          vectorStats = {
            error: getErrorMessage(vecError),
            suggestion: 'Vector table may be corrupted and need recreation'
          };
        }
      } else {
        vectorHealth = 'extension_unavailable';
      }

    } catch (error: unknown) {
      return NextResponse.json({
        status: 'error',
        message: 'Failed to collect vector statistics',
        details: getErrorMessage(error)
      });
    }

    return NextResponse.json({
      status: 'success',
      data: {
        database_connected: connectionTest,
        vector_extension_loaded: vectorExtensionTest,
        vector_health: vectorHealth,
        chunk_stats: chunkStats,
        vector_stats: vectorStats,
        recommendations: generateRecommendations(vectorHealth, chunkStats, vectorStats)
      }
    });

  } catch (error: unknown) {
    console.error('Vector health check failed:', error);
    return NextResponse.json({
      status: 'error',
      message: 'Health check failed',
      details: getErrorMessage(error)
    });
  }
}

function generateRecommendations(
  vectorHealth: string, 
  chunkStats: ChunkStats | null, 
  vectorStats: VectorStats
): string[] {
  const recommendations: string[] = [];

  if (vectorHealth === 'corrupted') {
    recommendations.push('Vector tables are corrupted - restart the application to trigger automatic healing');
  }

  if (vectorHealth === 'extension_unavailable') {
    recommendations.push('Vector extension not loaded - check sqlite-vec installation');
  }

  if (chunkStats && chunkStats.coverage_percentage < 95) {
    recommendations.push(`${chunkStats.missing_embeddings} chunks missing embeddings - consider running embedding generation`);
  }

  if (
    vectorStats &&
    'matches_chunk_embeddings' in vectorStats &&
    !vectorStats.matches_chunk_embeddings
  ) {
    recommendations.push('Vector count does not match chunk embeddings - database inconsistency detected');
  }

  if (recommendations.length === 0) {
    recommendations.push('Vector search system is healthy');
  }

  return recommendations;
}
