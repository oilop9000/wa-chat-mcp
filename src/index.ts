import dotenv from 'dotenv';
dotenv.config(); // Load environment variables from .env file

import { startServer as startHttpStreamServer } from './mcp/http-stream-server';
import * as BaileysCore from './core/baileys';
import * as McpSessionManager from './mcp/mcp-session-manager';
import * as BaileysSessionManager from './core/baileys-session-manager'; // For cleanup jobs
import { handleMcpClientAction } from './mcp/mcp-message-handler'; // To handle actions from MCP client
import http from 'http'; // For extending the server
import { URL } from 'url';

const log = (message: string, data?: any) => {
  console.log(`[MainApp] ${message}`, data || '');
};

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const MCP_SERVER_PORT = process.env.MCP_SERVER_PORT ? parseInt(process.env.MCP_SERVER_PORT, 10) : PORT + 1; // Separate port for MCP actions if needed, or combine

async function main() {
  log('Starting application...');

  // Start the HTTP Stream Server (for SSE events to clients)
  // The existing http-stream-server handles /events/:sessionId for SSE
  const sseServer = startHttpStreamServer(MCP_SERVER_PORT);
  log(`MCP Event Stream Server (SSE) listening on port ${MCP_SERVER_PORT}`);


  // --- Extend the existing SSE server to handle incoming MCP client actions ---
  // We'll add a new route, e.g., POST /mcp/:sessionId/action
  // Or, we can create a new http.Server instance if we want to keep concerns very separate.
  // For simplicity, let's try to augment the existing server's request handling logic.
  // This requires modifying http-stream-server.ts or by-passing its direct handler.
  // Alternative: Create a dedicated server for client actions.
  // Let's create a simple dedicated action server for now to keep http-stream-server focused on SSE.

  const actionServer = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || '', `http://${req.headers.host}`);
    log(`[ActionServer] Request: ${req.method} ${requestUrl.pathname}`);

    // CORS Preflight for action endpoint
    if (req.method === 'OPTIONS' && requestUrl.pathname.startsWith('/mcp/')) {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*', // Adjust as needed
            'Access-Control-Allow-Methods': 'POST, OPTIONS', // Add other methods if needed
            'Access-Control-Allow-Headers': 'Content-Type, X-Session-ID', // Add custom headers like X-Session-ID
            'Access-Control-Max-Age': 86400,
        });
        res.end();
        return;
    }

    // Set CORS headers for actual requests
    res.setHeader('Access-Control-Allow-Origin', '*'); // Adjust as needed

    if (req.method === 'POST' && requestUrl.pathname.startsWith('/mcp/action/')) {
      const pathParts = requestUrl.pathname.split('/');
      const mcpSessionId = pathParts[3]; // Expects /mcp/action/:sessionId

      if (!mcpSessionId) {
        log('[ActionServer] Missing MCP session ID in path.');
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'MCP Session ID is required in the path: /mcp/action/:sessionId' }));
        return;
      }

      // Verify session exists (optional, depends on if actions are allowed for non-SSE sessions)
      const mcpSession = McpSessionManager.getSession(mcpSessionId);
      if (!mcpSession) {
          // If an action is received for a session that doesn't have an active SSE stream,
          // it might be an issue, or it might be a valid scenario (e.g., one-off command).
          // For now, let's allow it but log a warning.
          log(`[ActionServer] Warning: Action received for MCP session ${mcpSessionId} which does not have an active SSE stream.`);
      }


      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', async () => {
        try {
          log(`[ActionServer] Received action for session ${mcpSessionId}. Body: ${body.substring(0, 200)}...`);
          if (!body) {
            throw new Error('Request body is empty.');
          }
          const action = JSON.parse(body);

          // Validate action structure (basic)
          if (!action.actionType || !action.payload) {
            throw new Error('Invalid action format. Requires actionType and payload.');
          }

          await handleMcpClientAction(mcpSessionId, action);
          // handleMcpClientAction will use McpEventEmitter to send a response/ack via SSE.
          // So, the HTTP response here is just to acknowledge receipt of the POST.
          res.writeHead(202, { 'Content-Type': 'application/json' }); // 202 Accepted
          res.end(JSON.stringify({ status: 'action_received', message: 'Action received and is being processed.', _requestId: action.requestId }));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          log(`[ActionServer] Error processing action for session ${mcpSessionId}: ${errorMessage}`);
          res.writeHead(400, { 'Content-Type': 'application/json' }); // Bad Request
          res.end(JSON.stringify({ error: 'Failed to process action', details: errorMessage }));
        }
      });
       req.on('error', (err) => {
            log(`[ActionServer] Request error for session ${mcpSessionId}: ${err.message}`);
            if (!res.closed) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Server request error' }));
            }
        });

    } else if (req.method === 'POST' && requestUrl.pathname === '/mcp/session/init') {
      // New endpoint to explicitly initialize a Baileys session for an MCP session
      // The MCP client would first connect to SSE to get an mcpSessionId,
      // then call this endpoint with that mcpSessionId.
      const mcpSessionId = req.headers['x-session-id'] as string; // Get mcpSessionId from a header

      if (!mcpSessionId) {
        log('[ActionServer] Missing X-Session-ID header for /mcp/session/init');
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'X-Session-ID header is required.' }));
        return;
      }

      const mcpSession = McpSessionManager.getSession(mcpSessionId);
      if (!mcpSession) {
        log(`[ActionServer] MCP session ${mcpSessionId} not found for init. Client should connect to SSE first.`);
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `MCP session ${mcpSessionId} not found. Ensure SSE connection is established first at /events/${mcpSessionId}.` }));
        return;
      }

      log(`[ActionServer] Initializing Baileys for MCP Session ID: ${mcpSessionId}`);
      try {
        // The Baileys initialization will use the adapter callbacks which in turn use McpEventEmitter
        // to send QR updates, connection status, etc., over the existing SSE stream.
        await BaileysCore.initializeBaileysForMcpSession(mcpSessionId);
        log(`[ActionServer] Baileys initialization process started for ${mcpSessionId}. QR (if any) will be sent via SSE.`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'baileys_initialization_started', mcpSessionId: mcpSessionId, message: 'Baileys initialization process started. Check SSE stream for QR code or connection updates.' }));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`[ActionServer] Error initializing Baileys for ${mcpSessionId}: ${errorMessage}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to initialize Baileys session', details: errorMessage }));
      }

    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Not Found. Available action endpoint: POST /mcp/action/:sessionId or POST /mcp/session/init (with X-Session-ID header)' }));
    }
  });

  const ACTION_SERVER_PORT = process.env.ACTION_SERVER_PORT ? parseInt(process.env.ACTION_SERVER_PORT) : MCP_SERVER_PORT + 1;
  actionServer.listen(ACTION_SERVER_PORT, () => {
    log(`MCP Action Server listening on port ${ACTION_SERVER_PORT}`);
    log(`  - POST /mcp/session/init (Header: X-Session-ID) -> To start Baileys for an SSE session.`);
    log(`  - POST /mcp/action/:sessionId -> To send commands like SEND_TEXT_MESSAGE.`);
  });
  actionServer.on('error', (error) => {
    log(`[ActionServer] Server error: ${error.message}`);
    if ((error as any).code === 'EADDRINUSE') {
        console.error(`Error: Port ${ACTION_SERVER_PORT} is already in use for Action Server.`);
        process.exit(1);
    }
  });


  // Setup periodic cleanup for stale sessions
  const STALE_SESSION_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
  setInterval(() => {
    log('Running periodic cleanup tasks...');
    McpSessionManager.cleanupStaleSessions(); // Cleans up SSE sessions
    BaileysSessionManager.cleanupInactiveBaileysSessions(); // Cleans up inactive Baileys instances
  }, STALE_SESSION_CLEANUP_INTERVAL);
  log(`Periodic session cleanup scheduled every ${STALE_SESSION_CLEANUP_INTERVAL / 60000} minutes.`);


  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
  signals.forEach(signal => {
    process.on(signal, async () => {
      log(`Received ${signal}. Shutting down gracefully...`);

      // Close servers
      sseServer.close(() => log('SSE Server closed.'));
      actionServer.close(() => log('Action Server closed.'));

      // Add any other cleanup tasks, e.g., disconnecting active Baileys sessions
      const activeBaileysSessions = BaileysSessionManager.baileysSessions; // Assuming direct access or a getter
      if (activeBaileysSessions) { // Check if baileysSessions is exported or add a getter
          log(`Cleaning up ${activeBaileysSessions.size} active Baileys sessions...`);
          for (const mcpSessionId of activeBaileysSessions.keys()) {
              try {
                  await BaileysCore.disconnectBaileysForMcpSession(mcpSessionId, false); // false: don't delete auth on shutdown by default
              } catch (err) {
                  log(`Error disconnecting Baileys session ${mcpSessionId} during shutdown: ${err}`);
              }
          }
      }

      // Give some time for cleanup, then exit
      setTimeout(() => {
        log('Exiting.');
        process.exit(0);
      }, 3000); // Adjust timeout as needed
    });
  });

  log('Application started successfully.');
}

main().catch(error => {
  log('Unhandled error in main function:', error);
  process.exit(1);
});
