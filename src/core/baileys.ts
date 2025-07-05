import {
    WAMessage,
    DisconnectReasonKey,
    DisconnectReason
} from '@whiskeysockets/baileys';
import * as BaileysSessionManager from './baileys-session-manager';
import * as McpEventEmitter from '../mcp/mcp-event-emitter';
// import { MessageType, MessageContent } from '@whiskeysockets/baileys' // For sending messages

const log = (mcpSessionId: string, message: string) => {
  console.log(`[BaileysCore][${mcpSessionId}] ${message}`);
};

/**
 * Initializes a Baileys connection for a given MCP session ID and sets up
 * adapters to forward Baileys events to the MCP client.
 *
 * @param mcpSessionId The MCP session ID.
 * @returns Promise<void>
 * @throws Error if initialization fails.
 */
export async function initializeBaileysForMcpSession(mcpSessionId: string): Promise<void> {
  log(mcpSessionId, 'Initializing Baileys connection...');

  try {
    await BaileysSessionManager.getOrCreateBaileysSession(
      mcpSessionId,
      {
        onQR: (qr) => {
          log(mcpSessionId, 'QR code received for Baileys. Forwarding to MCP client.');
          McpEventEmitter.sendEventToClient(mcpSessionId, 'baileys_qr_update', { qr });
        },
        onConnected: () => {
          log(mcpSessionId, 'Baileys connected successfully. Notifying MCP client.');
          McpEventEmitter.sendEventToClient(mcpSessionId, 'baileys_connected', { message: 'Baileys connection established.' });
        },
        onDisconnected: (reason: DisconnectReasonKey | undefined, currentMcpSessionId: string) => {
          // Ensure we are handling the event for the correct session, though 'this' mcpSessionId should be the one.
          log(currentMcpSessionId, `Baileys disconnected. Reason: ${reason || 'Unknown'}. Notifying MCP client.`);
          McpEventEmitter.sendEventToClient(currentMcpSessionId, 'baileys_disconnected', {
            reason: String(reason || 'Unknown'), // Ensure reason is a string
            loggedOut: reason === DisconnectReason.loggedOut // Compare with direct import
          });
          // The BaileysSessionManager handles actual session cleanup for loggedOut cases.
          // If not loggedOut, Baileys might attempt reconnection internally.
        },
        onMessage: (message: WAMessage, currentMcpSessionId) => {
          // Ensure we are handling the event for the correct session.
          log(currentMcpSessionId, `New message received from Baileys. Forwarding to MCP client. ID: ${message.key.id}`);
          // We'll forward the raw Baileys message object for now.
          // The MCP client or a more sophisticated adapter can then parse it.
          // Consider what parts of the message are essential for the MCP client.
          // For media, this is where media-handler would be involved later.
          McpEventEmitter.sendEventToClient(currentMcpSessionId, 'baileys_new_message', { message });
        },
        // Add other necessary callbacks here, e.g., for presence updates, contact changes, etc.
      }
      // We can pass Baileys socket options here if needed, e.g.:
      // { browser: Browsers.appropriate('Desktop') }
    );
    log(mcpSessionId, 'Baileys instance created and event listeners configured via BaileysSessionManager.');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(mcpSessionId, `Error initializing Baileys: ${errorMessage}`);
    McpEventEmitter.sendEventToClient(mcpSessionId, 'baileys_error', {
      message: `Failed to initialize Baileys: ${errorMessage}`,
      isInitializationError: true,
    });
    // Propagate the error so the caller (e.g., in index.ts) can handle it,
    // perhaps by not proceeding with this MCP session.
    throw new Error(`Baileys initialization failed for MCP session ${mcpSessionId}: ${errorMessage}`);
  }
}

/**
 * Sends a text message via Baileys for a specific MCP session.
 *
 * @param mcpSessionId The MCP session ID.
 * @param recipientJid The JID of the recipient (e.g., '1234567890@s.whatsapp.net').
 * @param text The text message to send.
 * @returns Promise<WAMessage | undefined> The sent message object or undefined on failure.
 */
export async function sendTextMessage(
  mcpSessionId: string,
  recipientJid: string,
  text: string
): Promise<WAMessage | undefined> {
  log(mcpSessionId, `Attempting to send text message to ${recipientJid}`);
  const socket = BaileysSessionManager.getBaileysSocket(mcpSessionId);

  if (!socket) {
    log(mcpSessionId, `No active Baileys socket found for session. Cannot send message.`);
    McpEventEmitter.sendEventToClient(mcpSessionId, 'baileys_error', {
        message: 'Cannot send message: Baileys session not active or not found.',
        details: `Attempted to send to ${recipientJid}`
    });
    return undefined;
  }

  try {
    // Ensure the JID is valid (basic check)
    if (!recipientJid.includes('@')) { // TODO: More robust JID validation
        log(mcpSessionId, `Invalid recipient JID: ${recipientJid}`);
        McpEventEmitter.sendEventToClient(mcpSessionId, 'baileys_error', {
            message: `Invalid recipient JID format: ${recipientJid}`,
        });
        return undefined;
    }

    const sentMessage = await socket.sendMessage(recipientJid, { text });
    log(mcpSessionId, `Text message sent successfully to ${recipientJid}. Message ID: ${sentMessage?.key.id}`);
    return sentMessage;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(mcpSessionId, `Error sending text message to ${recipientJid}: ${errorMessage}`);
    McpEventEmitter.sendEventToClient(mcpSessionId, 'baileys_error', {
        message: `Failed to send text message to ${recipientJid}: ${errorMessage}`,
    });
    return undefined;
  }
}

/**
 * Disconnects and cleans up the Baileys instance for a given MCP session.
 * @param mcpSessionId The MCP session ID.
 * @param deleteAuthState If true, also deletes the persisted authentication data.
 */
export async function disconnectBaileysForMcpSession(mcpSessionId: string, deleteAuthState: boolean = false): Promise<void> {
    log(mcpSessionId, `Disconnecting Baileys session. Delete auth state: ${deleteAuthState}`);
    try {
        await BaileysSessionManager.removeBaileysSession(mcpSessionId, deleteAuthState);
        log(mcpSessionId, `Baileys session disconnected and cleaned up successfully.`);
        McpEventEmitter.sendEventToClient(mcpSessionId, 'baileys_disconnected', {
            reason: 'manual_logout', // Or a more specific reason if provided
            loggedOut: deleteAuthState, // If auth state is deleted, it's effectively a logout
            message: `Baileys session for ${mcpSessionId} has been disconnected.`
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(mcpSessionId, `Error during Baileys disconnection: ${errorMessage}`);
        McpEventEmitter.sendEventToClient(mcpSessionId, 'baileys_error', {
            message: `Error disconnecting Baileys session ${mcpSessionId}: ${errorMessage}`,
        });
    }
}


// TODO: Add more functions for other Baileys actions as needed:
// - sendMediaMessage (will use media-handler)
// - fetchContacts, fetchChats
// - updatePresence, etc.

log('System', 'Baileys Core module initialized.');
