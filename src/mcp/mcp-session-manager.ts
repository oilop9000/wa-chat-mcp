import { ServerResponse } from 'http';
import { v4 as uuidv4 } from 'uuid';

interface McpSession {
  id: string;
  connection: ServerResponse; // For SSE, this would be the response object
  lastSeen: Date;
}

// In-memory store for sessions. For production, consider a persistent store.
const sessions = new Map<string, McpSession>();

/**
 * Creates and registers a new MCP session.
 * @param connection The HTTP ServerResponse object for the stream.
 * @returns The ID of the newly created session.
 */
export function createSession(connection: ServerResponse): string {
  const sessionId = uuidv4();
  const newSession: McpSession = {
    id: sessionId,
    connection,
    lastSeen: new Date(),
  };
  sessions.set(sessionId, newSession);
  console.log(`[MCP Session Manager] Session created: ${sessionId}`);
  return sessionId;
}

/**
 * Retrieves an active MCP session by its ID.
 * @param sessionId The ID of the session to retrieve.
 * @returns The session object or undefined if not found.
 */
export function getSession(sessionId: string): McpSession | undefined {
  const session = sessions.get(sessionId);
  if (session) {
    session.lastSeen = new Date(); // Update last seen on access
  }
  return session;
}

/**
 * Removes an MCP session.
 * @param sessionId The ID of the session to remove.
 */
export function removeSession(sessionId: string): void {
  if (sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    if (session && !session.connection.closed) {
      session.connection.end(); // Ensure the connection is closed
      console.log(`[MCP Session Manager] Connection for session ${sessionId} ended.`);
    }
    sessions.delete(sessionId);
    console.log(`[MCP Session Manager] Session removed: ${sessionId}`);
  } else {
    console.warn(`[MCP Session Manager] Attempted to remove non-existent session: ${sessionId}`);
  }
}

/**
 * Periodically cleans up stale sessions.
 * @param maxIdleTimeMs Maximum idle time in milliseconds before a session is considered stale.
 */
export function cleanupStaleSessions(maxIdleTimeMs: number = 10 * 60 * 1000): void { // Default 10 minutes
  const now = new Date();
  sessions.forEach((session, sessionId) => {
    if (now.getTime() - session.lastSeen.getTime() > maxIdleTimeMs) {
      console.log(`[MCP Session Manager] Stale session found: ${sessionId}. Cleaning up.`);
      removeSession(sessionId);
    }
  });
}

// Example: Start periodic cleanup (e.g., every 5 minutes)
// setInterval(() => cleanupStaleSessions(), 5 * 60 * 1000);
// This should be started in the main application entry point if desired.

console.log('[MCP Session Manager] Initialized.');
