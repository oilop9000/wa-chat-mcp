import * as McpSessionManager from './mcp-session-manager';

const log = (message: string) => console.log(`[MCP Event Emitter] ${message}`);

/**
 * Sends an event to a specific MCP client via their SSE connection.
 *
 * @param sessionId The ID of the MCP session (client).
 * @param eventType A string identifying the type of event (e.g., 'qr_update', 'new_message').
 * @param data The payload of the event.
 * @returns True if the event was sent successfully, false otherwise.
 */
export function sendEventToClient(sessionId: string, eventType: string, data: any): boolean {
  const session = McpSessionManager.getSession(sessionId);

  if (!session) {
    log(`Session not found: ${sessionId}. Cannot send event '${eventType}'.`);
    return false;
  }

  if (session.connection.closed || session.connection.destroyed) {
    log(`Connection for session ${sessionId} is closed or destroyed. Cannot send event '${eventType}'.`);
    // Optionally, attempt to remove the session here if it's unexpectedly closed
    // McpSessionManager.removeSession(sessionId);
    return false;
  }

  try {
    // SSE format:
    // event: <event_type>
    // data: <json_stringified_data>
    // id: <optional_event_id>
    // retry: <optional_retry_timeout_ms>
    // \n\n (terminator)

    let eventString = '';
    if (eventType) {
      eventString += `event: ${eventType}\n`;
    }
    // Always send data, even if it's null, to make client-side handling consistent
    eventString += `data: ${JSON.stringify(data)}\n\n`;

    session.connection.write(eventString);
    // log(`Event '${eventType}' sent to session ${sessionId}. Data: ${JSON.stringify(data)}`);
    return true;
  } catch (error) {
    log(`Error sending event '${eventType}' to session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    // If writing fails, the connection might be broken.
    // Consider closing and removing the session.
    // McpSessionManager.removeSession(sessionId);
    return false;
  }
}

/**
 * Broadcasts an event to all active MCP clients.
 *
 * @param eventType A string identifying the type of event.
 * @param data The payload of the event.
 */
// export function broadcastEvent(eventType: string, data: any): void {
//   const sessions = McpSessionManager.getAllSessions(); // Assuming getAllSessions() exists in McpSessionManager
//   log(`Broadcasting event '${eventType}' to ${sessions.size} clients.`);
//   sessions.forEach((session) => {
//     sendEventToClient(session.id, eventType, data);
//   });
// }

// Note: To implement broadcastEvent, McpSessionManager would need a `getAllSessions` method.
// For now, focusing on sendEventToClient.

log('Initialized.');
