import http, { IncomingMessage, ServerResponse } from 'http';
import * as McpSessionManager from './mcp-session-manager';
import { URL } from 'url'; // Import URL for parsing

// Simple logger
const log = (message: string) => console.log(`[HTTP Stream Server] ${message}`);

/**
 * Initializes and starts the HTTP server for streaming events.
 * @param port The port number to listen on.
 * @param mcpSessionManager The MCP session manager instance.
 */
export function startServer(port: number): http.Server {
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const requestUrl = new URL(req.url || '', `http://${req.headers.host}`);
    log(`Request received: ${req.method} ${requestUrl.pathname}`);

    // Endpoint for establishing an event stream
    // Expects a path like /events or /events/some-identifier
    // For now, we'll auto-generate a session ID if none is provided in the path
    // or use the one provided.
    if (req.method === 'GET' && requestUrl.pathname.startsWith('/events')) {
      // Set headers for SSE
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*', // Allow all origins (CORS) - adjust as needed
      });
      log('SSE connection headers set.');

      // Extract a potential session ID from the path, e.g., /events/my-session-id
      const pathParts = requestUrl.pathname.split('/');
      let sessionId: string | undefined = undefined;
      if (pathParts.length > 2 && pathParts[2]) {
        sessionId = pathParts[2];
        // Optional: Validate sessionId format or if it already exists,
        // depending on whether clients can reconnect to existing sessions by ID.
        // For now, we assume a new session or a reconnection attempt.
        const existingSession = McpSessionManager.getSession(sessionId);
        if (existingSession) {
            log(`Client attempting to reconnect to existing session: ${sessionId}`);
            // Potentially close the old connection if it's still somehow open
            if (existingSession.connection && !existingSession.connection.closed) {
                log(`Closing previous connection for session ${sessionId}`);
                existingSession.connection.end();
            }
            // Update the connection object for the existing session
            McpSessionManager.removeSession(sessionId); // Remove first to avoid issues with map replacement
        }
      }

      // If no valid session ID from path or if it was a reconnect, create a new one.
      // Or, if you want clients to *always* create new sessions on /events:
      sessionId = McpSessionManager.createSession(res);
      log(`New SSE connection established. Session ID: ${sessionId}`);

      // Send an initial "connected" event or session ID
      res.write(`event: session_established\ndata: ${JSON.stringify({ sessionId })}\n\n`);

      // Keep the connection alive by sending periodic comments (heartbeat)
      const heartbeatInterval = setInterval(() => {
        if (res.closed) {
          clearInterval(heartbeatInterval);
          McpSessionManager.removeSession(sessionId!); // sessionId will be defined here
          log(`SSE connection closed for session ${sessionId}. Heartbeat stopped.`);
          return;
        }
        // SSE comments start with a colon
        res.write(':heartbeat\n\n');
        // log(`Heartbeat sent to session ${sessionId}`);
      }, 15000); // Send a heartbeat every 15 seconds

      // Handle client disconnection
      req.on('close', () => {
        clearInterval(heartbeatInterval);
        McpSessionManager.removeSession(sessionId!); // sessionId will be defined here
        log(`Client disconnected. Session ID: ${sessionId} removed.`);
      });

      req.on('error', (err) => {
        clearInterval(heartbeatInterval);
        McpSessionManager.removeSession(sessionId!); // sessionId will be defined here
        log(`Error on request for session ${sessionId}: ${err.message}. Session removed.`);
        if (!res.closed) {
          res.end();
        }
      });

    } else if (req.method === 'OPTIONS' && requestUrl.pathname.startsWith('/events')) {
        // Handle CORS preflight requests
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*', // Adjust as needed
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type', // Add any other headers client might send
            'Access-Control-Max-Age': 86400, // Cache preflight response for 1 day
        });
        res.end();
    } else {
      // Handle other routes or methods
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Not Found' }));
      log(`404 Not Found for ${req.method} ${requestUrl.pathname}`);
    }
  });

  server.listen(port, () => {
    log(`Server listening on port ${port}`);
  });

  server.on('error', (error) => {
    log(`Server error: ${error.message}`);
    // Handle specific listening errors with friendly messages
    if ((error as any).code === 'EADDRINUSE') {
        console.error(`Error: Port ${port} is already in use.`);
        process.exit(1);
    }
  });

  return server;
}

// Example usage (typically called from src/index.ts):
// if (require.main === module) {
//   const PORT = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT) : 3000;
//   startServer(PORT);
//   log('HTTP Stream Server started for standalone testing.');
// }
