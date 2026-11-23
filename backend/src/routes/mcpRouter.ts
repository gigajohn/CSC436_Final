import { Router, Request, Response, NextFunction } from 'express';
import { validateBearerToken, DEMO_PERSONAS, McpAuthError } from '../mcp/mcpAuth.js';
import { MCP_TOOLS, executeMcpTool } from '../mcp/mcpTools.js';
import { mcpStore } from '../mcp/mcpStore.js';

export const mcpRouter = Router();

// Helper endpoint for interactive MCP App: GET /api/v1/mcp/personas
mcpRouter.get('/personas', (_req: Request, res: Response) => {
  res.status(200).json({
    personas: Object.values(DEMO_PERSONAS),
  });
});

// Helper endpoint: GET /api/v1/mcp/tools
mcpRouter.get('/tools', (req: Request, res: Response, next: NextFunction) => {
  try {
    // Requires authenticated token to discover tools
    validateBearerToken(req.headers.authorization);
    res.status(200).json({
      tools: MCP_TOOLS,
    });
  } catch (err) {
    next(err);
  }
});

// Audit trail inspection: GET /api/v1/mcp/audit
mcpRouter.get('/audit', (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = validateBearerToken(req.headers.authorization);
    // Requires authenticated token with submissions or reviews read scope
    if (!auth.scopes.some((s) => s.startsWith('mcp:'))) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Inspection of audit trail requires an authorized MCP scope.',
        },
      });
      return;
    }
    const limit = Number(req.query.limit) || 50;
    res.status(200).json({
      auditTrail: mcpStore.getAuditTrail(limit),
    });
  } catch (err) {
    next(err);
  }
});

// Standard MCP Protocol Endpoint: POST /api/v1/mcp
mcpRouter.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    // Requirement F12 Hard Gate: Authenticate Bearer Token
    const auth = validateBearerToken(req.headers.authorization);

    const body = req.body as {
      jsonrpc?: string;
      id?: string | number;
      method?: string;
      params?: {
        name?: string;
        arguments?: Record<string, unknown>;
      };
    };

    const requestId = body.id ?? 1;

    // Handle tools/list
    if (body.method === 'tools/list') {
      res.status(200).json({
        jsonrpc: '2.0',
        id: requestId,
        result: {
          tools: MCP_TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            requiresConfirmation: t.requiresConfirmation,
            requiredScope: t.requiredScope,
          })),
        },
      });
      return;
    }

    // Handle tools/call
    if (body.method === 'tools/call') {
      const toolName = body.params?.name;
      const toolArgs = body.params?.arguments || {};

      if (!toolName) {
        res.status(400).json({
          jsonrpc: '2.0',
          id: requestId,
          error: {
            code: -32602,
            message: 'Invalid params: tool name is required.',
          },
        });
        return;
      }

      // Execute tool with authorization and confirmation gating
      const result = executeMcpTool(toolName, toolArgs, auth);

      res.status(200).json({
        jsonrpc: '2.0',
        id: requestId,
        result,
      });
      return;
    }

    // Unsupported MCP JSON-RPC method
    res.status(400).json({
      jsonrpc: '2.0',
      id: requestId,
      error: {
        code: -32601,
        message: `Method "${body.method}" is not supported by this MCP server.`,
      },
    });
  } catch (err) {
    if (err instanceof McpAuthError) {
      res.status(err.statusCode).json({
        jsonrpc: '2.0',
        id: req.body?.id ?? null,
        error: {
          code: err.code,
          message: err.message,
        },
      });
      return;
    }
    next(err);
  }
});

