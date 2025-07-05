import * as BaileysCore from '../core/baileys';
import * as BaileysSessionManager from '../core/baileys-session-manager'; // Import this directly
import * as MediaHandler from '../media/media-handler';
import * as McpEventEmitter from './mcp-event-emitter';
// import { McpMessage, McpAction } from '../types/mcp'; // Assuming types for MCP messages/actions

const log = (mcpSessionId: string, message: string, data?: any) => {
  console.log(`[MCP MessageHandler][${mcpSessionId}] ${message}`, data || '');
};

// Define expected structure for incoming MCP actions (client -> server)
// This should align with the ModelContextProtocol specifications if available.
// For now, a generic structure:
interface McpClientAction {
  actionType: string; // e.g., 'SEND_TEXT_MESSAGE', 'SEND_IMAGE', 'GET_CONTACTS'
  payload: any;
  requestId?: string; // Optional: for client to correlate responses
}


/**
 * Handles actions/messages received from an MCP client.
 * These actions are typically commands for the server to perform,
 * such as sending a WhatsApp message.
 *
 * @param mcpSessionId The ID of the MCP client session.
 * @param action The action object received from the MCP client.
 */
export async function handleMcpClientAction(mcpSessionId: string, action: McpClientAction): Promise<void> {
  log(mcpSessionId, `Received action from MCP client. Type: ${action.actionType}`, { payload: action.payload, requestId: action.requestId });

  const sendResponse = (eventType: string, data: any) => {
    const responsePayload = {
      ...data,
      _originalActionType: action.actionType,
      _requestId: action.requestId, // Echo back requestId for correlation
    };
    McpEventEmitter.sendEventToClient(mcpSessionId, eventType, responsePayload);
  };

  try {
    switch (action.actionType) {
      case 'SEND_TEXT_MESSAGE':
        // Payload example: { recipientJid: 'xxxxxxxx@s.whatsapp.net', text: 'Hello!' }
        if (!action.payload?.recipientJid || typeof action.payload?.text !== 'string') {
          throw new Error('Invalid payload for SEND_TEXT_MESSAGE. Requires recipientJid and text.');
        }
        const sentMsg = await BaileysCore.sendTextMessage(
          mcpSessionId,
          action.payload.recipientJid,
          action.payload.text
        );
        if (sentMsg) {
          sendResponse('mcp_action_success', {
            message: 'Text message sent successfully via Baileys.',
            baileysMessageId: sentMsg.key.id,
            details: { recipientJid: action.payload.recipientJid }
          });
        } else {
          throw new Error('BaileysCore.sendTextMessage returned undefined. Sending failed.');
        }
        break;

      case 'SEND_IMAGE_MESSAGE': // Example for sending media
        // Payload example: { recipientJid: 'xxxx@s.whatsapp.net', mediaSource: 'url_or_path_or_base64', caption: 'My Image', fileName: 'image.jpg', mimeType: 'image/jpeg' }
        if (!action.payload?.recipientJid || !action.payload?.mediaSource) {
          throw new Error('Invalid payload for SEND_IMAGE_MESSAGE. Requires recipientJid and mediaSource.');
        }

        // 1. Prepare media using MediaHandler
        // mediaSource could be a URL, a local path (if server has access), or base64 data string
        // For simplicity, let's assume mediaSource is a publicly accessible URL or a base64 string for now.
        // If it's a path, security implications need careful consideration.
        let mediaBufferSource: string | Buffer;
        if (typeof action.payload.mediaSource === 'string' && action.payload.mediaSource.startsWith('data:')) {
            // Handle base64 data URI
            const parts = action.payload.mediaSource.split(';base64,');
            if (parts.length !== 2) throw new Error('Invalid base64 data URI for mediaSource.');
            // const mimeTypeFromDataUri = parts[0].split(':')[1]; // TODO: use this if action.payload.mimeType is not set
            mediaBufferSource = Buffer.from(parts[1], 'base64');
            log(mcpSessionId, 'Media source is base64 data URI.');
        } else if (typeof action.payload.mediaSource === 'string') {
            mediaBufferSource = action.payload.mediaSource; // URL or Path (handle with care)
            log(mcpSessionId, `Media source is string (URL/Path): ${mediaBufferSource}`);
        } else {
            // Or if client can directly send buffer (less common over JSON/SSE)
            throw new Error('Unsupported mediaSource format. Must be URL, local path (server-side), or base64 data URI string.');
        }

        const baileysMediaContent = await MediaHandler.prepareMediaForSending(
          mcpSessionId,
          mediaBufferSource,
          'image', // messageType
          action.payload.caption,
          action.payload.fileName,
          action.payload.mimeType
        );

        // 2. Get Baileys socket
        const socket = BaileysSessionManager.getBaileysSocket(mcpSessionId);
        if (!socket) {
          throw new Error('Baileys session not found or not active.');
        }

        // 3. Send using socket.sendMessage
        const sentImageMsg = await socket.sendMessage(action.payload.recipientJid, baileysMediaContent);
        if (sentImageMsg) {
          sendResponse('mcp_action_success', {
            message: 'Image message sent successfully via Baileys.',
            baileysMessageId: sentImageMsg.key.id,
            details: { recipientJid: action.payload.recipientJid }
          });
        } else {
          throw new Error('socket.sendMessage for image returned undefined. Sending failed.');
        }
        break;

      // TODO: Implement handlers for other actions:
      // case 'SEND_VIDEO_MESSAGE':
      // case 'SEND_AUDIO_MESSAGE':
      // case 'SEND_DOCUMENT_MESSAGE':
      // case 'SEND_STICKER_MESSAGE':
      // case 'CREATE_GROUP':
      // case 'ADD_PARTICIPANT_TO_GROUP':
      // case 'GET_CONTACT_INFO':
      // case 'GET_CHATS':
      // case 'MARK_MESSAGE_AS_READ':
      // case 'REQUEST_BAILEYS_LOGOUT':
      //   log(mcpSessionId, 'Requesting Baileys logout and cleanup...');
      //   await BaileysCore.disconnectBaileysForMcpSession(mcpSessionId, true); // true to delete auth state
      //   sendResponse('mcp_action_success', { message: 'Baileys logout initiated.' });
      //   // The MCP HTTP stream server should also close the connection for this session.
      //   // This might need coordination or the client should expect the stream to end.
      //   McpSessionManager.removeSession(mcpSessionId); // This will close the SSE
      //   break;

      default:
        log(mcpSessionId, `Unknown or unsupported actionType: ${action.actionType}`);
        throw new Error(`Unknown or unsupported actionType: ${action.actionType}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(mcpSessionId, `Error handling MCP client action '${action.actionType}': ${errorMessage}`);
    sendResponse('mcp_action_error', {
      message: `Error processing action '${action.actionType}': ${errorMessage}`,
      details: (error as any).details || {}, // Include more details if available
    });
  }
}

// This handler would typically be called by the HTTP server component
// when it receives a message/command from an MCP client (e.g., via a POST request
// or a message over a WebSocket, distinct from the SSE event stream).

// For now, our http-stream-server.ts is only for SSE (server to client).
// We might need another HTTP endpoint (e.g., POST /mcp/:sessionId/action)
// or integrate this into the existing server if commands can come via other methods.
// If commands come via the same SSE stream (less common for client->server),
// the http-stream-server would need to parse them.

log('System', 'MCP Message Handler initialized.');
