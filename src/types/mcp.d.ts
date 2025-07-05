// MCP (Model Context Protocol) Type Definitions
// These types define the structure of messages and events exchanged
// between the MCP server (this application) and MCP clients.

/**
 * Represents events sent FROM the server TO the MCP client via SSE.
 */
export interface McpServerEvent {
  eventType: string;    // e.g., 'baileys_qr_update', 'baileys_new_message', 'mcp_action_success'
  payload: any;         // Data specific to the eventType
  timestamp: string;    // ISO 8601 timestamp
  mcpSessionId: string; // The client's MCP session ID
  eventId?: string;     // Optional unique ID for this specific event
}

// --- Baileys Related Events (Server to Client) ---

export interface McpBaileysQrUpdatePayload {
  qr: string;
}

export interface McpBaileysConnectionUpdatePayload {
  status: 'connected' | 'disconnected' | 'connecting' | 'reconnecting';
  message?: string;
  loggedOut?: boolean; // True if disconnected due to logout
  reason?: string;     // Disconnect reason string
}

// Using a simplified structure for Baileys messages forwarded to MCP client
// The client can use 'baileysRawMessage' for more complex needs if provided
export interface McpBaileysMessagePayload {
  id: string;           // Baileys message ID (WAMessageKey.id)
  from: string;         // Sender JID (WAMessageKey.remoteJid)
  participant?: string;  // Participant JID (if group message)
  timestamp: number;    // Unix timestamp (seconds)
  type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'reaction' | 'location' | 'contact' | 'contacts_array' | 'unknown' | string; // Message type
  text?: string;        // Text content (for text, caption)

  media?: {
    type: 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'unknown' | string;
    mimeType?: string;
    caption?: string;
    fileName?: string;
    // How client accesses media:
    // 1. `downloadUrl?: string;` // If server exposes a temporary download URL for the media
    // 2. `data?: string;`       // If media is small and sent as base64 string
    // For now, these are placeholders. Actual media transfer mechanism needs implementation.
    _serverInfo?: any; // Info that server might use but not directly for client (e.g. temp path)
    error?: string;    // If media processing failed
  };

  reaction?: {
    text: string | undefined | null; // Emoji
    targetMessageId: string | undefined | null;
  };

  location?: {
    degreesLatitude?: number | null;
    degreesLongitude?: number | null;
    name?: string | null;
    address?: string | null;
  };

  contact?: {
    displayName?: string | null;
    vcard?: string | null;
  };

  contacts?: Array<{
    displayName?: string | null;
    vcard?: string | null;
  }>;

  // To allow clients to access the full Baileys message if needed for specific parsing.
  // Use with caution as it makes the MCP client more tightly coupled to Baileys.
  baileysRawMessage?: any; // Consider making this optional or configurable
}

export interface McpBaileysErrorPayload {
  message: string;
  details?: any;
  isInitializationError?: boolean;
  actionType?: string; // If error relates to a specific client action
}


// --- MCP Action Related Events (Server to Client, typically responses) ---

export interface McpActionResponsePayload {
  _originalActionType: string; // The actionType from the client's request
  _requestId?: string;         // The requestId from the client's request (for correlation)
  message: string;
  details?: any;
  baileysMessageId?: string; // If action resulted in a Baileys message being sent
}

export interface McpActionErrorPayload extends McpActionResponsePayload {
  // Inherits from McpActionResponsePayload, message will contain error info
}


/**
 * Represents actions sent FROM the MCP client TO the server.
 * (e.g., via POST /mcp/action/:sessionId)
 */
export interface McpClientAction<P = any> {
  actionType: string; // e.g., 'SEND_TEXT_MESSAGE', 'INITIALIZE_BAILEYS_SESSION'
  payload: P;
  requestId?: string; // For client to correlate responses from server events
}

// --- Payloads for Specific Client Actions ---

export interface McpSendTextPayload {
  recipientJid: string;
  text: string;
  quotedMessageId?: string; // Optional: ID of the message to quote
}

export interface McpSendMediaPayload {
  recipientJid: string;
  mediaType: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  caption?: string;
  fileName?: string;
  mimeType?: string;
  // Media source: client can send base64 data URI or a URL that the server can fetch.
  // If server allows local paths, it's a security risk and needs careful handling.
  mediaSource: string; // e.g., 'data:image/jpeg;base64,...' or 'http://example.com/image.jpg'
  isVoiceNote?: boolean; // For audio type, if it's a PTT
}

export interface McpMarkAsReadPayload {
    messageId: string;
    remoteJid: string;
    participant?: string;
}

export interface McpRequestLogoutPayload {
    // No specific payload needed, actionType 'REQUEST_BAILEYS_LOGOUT' is enough
    // mcpSessionId is implicit from the request path or header
}

// Example of a more specific client action type
// export type McpSendTextMessageAction = McpClientAction<McpSendTextPayload>;

// This file provides a starting point.
// These types should be refined and expanded as the MCP protocol and application features evolve.
// Consider sharing these types between server and client projects if possible (e.g., as an npm package).

console.log('[MCP Types] Definitions loaded (runtime marker, not for production).');
