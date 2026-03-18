import { tool } from 'ai';
import { z } from 'zod';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { extractPaper } from '@/services/typescript/extractors/paper';
import { formatNodeForChat } from '../infrastructure/nodeFormatter';

interface ExtractedNodePayload {
  success: boolean;
  notes?: string;
  chunk?: string;
  metadata?: {
    title?: string;
    pages?: number;
    info?: { Author?: string } & Record<string, unknown>;
    filename?: string;
    extraction_method?: string;
    author?: string;
    file_size?: number;
    text_length?: number;
  };
  error?: string;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// AI-powered content analysis
async function analyzeContentWithAI(title: string, description: string, contentType: string) {
  try {
    const prompt = `Analyze this ${contentType} content and provide classification.

Title: "${title}"
Description: "${description}"

CRITICAL — nodeDescription rules (max 280 chars):
1. Say WHAT this literally is: "Paper by…", "Research from…", "Preprint introducing…"
2. Name the authors if known from the metadata.
3. State the actual finding, method, or contribution — not "a study on X" but what they actually found or built.
4. End with why it matters — one concrete phrase about impact or implication.
5. ABSOLUTELY FORBIDDEN: "discusses", "explores", "examines", "talks about", "delves into", "emphasizing the need for". State things directly.

Examples:
- Title: "Attention Is All You Need" / Authors: Vaswani et al.
  GOOD: "Vaswani et al. introduce the Transformer architecture — replaces recurrence with self-attention for sequence modeling. Foundation of every modern LLM."
  BAD: "This paper discusses a new architecture called the Transformer and explores its applications."

- Title: "Scaling Laws for Neural Language Models" / Authors: Kaplan et al.
  GOOD: "Kaplan et al. show that LLM performance scales as a power law with compute, data, and parameters — and compute matters most. The paper that launched the scaling era."
  BAD: "A study examining how neural language models scale with different factors."

Respond with ONLY valid JSON (no markdown, no code blocks):
{
  "enhancedDescription": "A comprehensive summary (3-6 paragraphs, 800-1500 chars). Cover key points, arguments, takeaways.",
  "nodeDescription": "<your 280-char description following the rules above>",
  "tags": ["relevant", "semantic", "tags"],
  "reasoning": "Brief explanation of classification choices"
}`;

    const response = await generateText({
      model: openai('gpt-4o-mini'),
      prompt,
      maxOutputTokens: 800
    });

    let content = response.text || '{}';

    // Clean up the response - remove markdown code blocks if present
    content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    const result = JSON.parse(content);

    return {
      enhancedDescription: result.enhancedDescription || description,
      nodeDescription: typeof result.nodeDescription === 'string' ? result.nodeDescription.slice(0, 280) : undefined,
      tags: Array.isArray(result.tags) ? result.tags : [],
      reasoning: result.reasoning || 'AI analysis completed'
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.warn('Paper analysis fallback (using default description):', message);
    return {
      enhancedDescription: description,
      nodeDescription: undefined,
      tags: [],
      reasoning: 'Fallback description used'
    };
  }
}

export const paperExtractTool = tool({
  description: 'Extract a PDF or research paper into a node with summary, metadata, and full-text chunk',
  inputSchema: z.object({
    url: z.string().describe('The PDF URL to add to inbox'),
    title: z.string().optional().describe('Custom title (auto-generated if not provided)'),
    dimensions: z.array(z.string()).min(1).max(5).optional().describe('Dimension tags to apply to the created node (locked dimensions first)')
  }),
  execute: async ({ url, title, dimensions }) => {
    try {
      // Validate PDF URL
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return {
          success: false,
          error: 'Invalid URL format - must start with http:// or https://',
          data: null
        };
      }

      // Check if URL likely points to a PDF
      if (!url.toLowerCase().includes('.pdf') && !url.includes('arxiv.org')) {
        return {
          success: false,
          error: 'URL does not appear to point to a PDF file',
          data: null
        };
      }

      let result: ExtractedNodePayload;
      
      try {
        const extractionResult = await extractPaper(url);
        result = {
          success: true,
          notes: extractionResult.content,
          chunk: extractionResult.chunk,
          metadata: {
            title: extractionResult.metadata.title,
            pages: extractionResult.metadata.pages,
            info: extractionResult.metadata.info,
            text_length: extractionResult.metadata.text_length,
            filename: extractionResult.metadata.filename,
            extraction_method: 'typescript'
          }
        };
      } catch (error: unknown) {
        result = { 
          success: false, 
          error: getErrorMessage(error) || 'TypeScript extraction failed' 
        };
      }

      if (!result.success || (!result.notes && !result.chunk)) {
        return {
          success: false,
          error: result.error || 'Failed to extract PDF content',
          data: null
        };
      }

      console.log('🎯 PDF extraction successful, analyzing with AI...');

      // Step 2: AI Analysis for enhanced metadata
      const aiAnalysis = await analyzeContentWithAI(
        result.metadata?.title || `PDF: ${new URL(url).pathname.split('/').pop()?.replace('.pdf', '')}`, 
        result.notes?.substring(0, 2000) || 'PDF document content', 
        'pdf'
      );

      // Step 3: Create node with extracted content and AI analysis
      const nodeTitle = title || result.metadata?.title || `PDF: ${new URL(url).pathname.split('/').pop()?.replace('.pdf', '')}`;
      const enhancedDescription = aiAnalysis?.enhancedDescription || `PDF document from ${new URL(url).hostname}`;
      
      const suppliedDimensions = Array.isArray(dimensions) ? dimensions : [];
      let trimmedDimensions = suppliedDimensions
        .map(dim => (typeof dim === 'string' ? dim.trim() : ''))
        .filter(Boolean);

      trimmedDimensions = trimmedDimensions.slice(0, 5);

      const createResponse = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: nodeTitle,
          description: aiAnalysis?.nodeDescription,
          notes: enhancedDescription,
          link: url,
          dimensions: trimmedDimensions,
          chunk: result.chunk || result.notes,
          metadata: {
            source: 'pdf',
            hostname: new URL(url).hostname,
            author: result.metadata?.author || result.metadata?.info?.Author,
            pages: result.metadata?.pages,
            file_size: result.metadata?.file_size,
            content_length: (result.chunk || result.notes)?.length,
            extraction_method: result.metadata?.extraction_method || 'python_pdfplumber',
            ai_analysis: aiAnalysis?.reasoning,
            enhanced_description: enhancedDescription,
            refined_at: new Date().toISOString()
          }
        })
      });

      const createResult = await createResponse.json();

      if (!createResponse.ok) {
        return {
          success: false,
          error: createResult.error || 'Failed to create node',
          data: null
        };
      }

      console.log('🎯 PaperExtract completed successfully');

      // Use actual assigned dimensions from API response (includes auto-assigned locked + keywords)
      const actualDimensions: string[] = createResult.data?.dimensions || trimmedDimensions || [];
      const formattedNode = createResult.data?.id
        ? formatNodeForChat({ id: createResult.data.id, title: nodeTitle, dimensions: actualDimensions })
        : nodeTitle;
      const dimsDisplay = actualDimensions.length > 0 ? actualDimensions.join(', ') : 'none';

      return {
        success: true,
        message: `Added ${formattedNode} with dimensions: ${dimsDisplay}`,
        data: {
          nodeId: createResult.data?.id,
          title: nodeTitle,
          contentLength: (result.chunk || result.notes || '').length,
          url: url,
          dimensions: actualDimensions
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to extract PDF content',
        data: null
      };
    }
  }
});
