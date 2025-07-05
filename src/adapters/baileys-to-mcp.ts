import {
    WAMessage,
    DisconnectReasonKey,
    DisconnectReason
} from '@whiskeysockets/baileys';
import * as McpEventEmitter from '../mcp/mcp-event-emitter';
import * as MediaHandler from '../media/media-handler';
import { presencia } from '@modelcontextprotocol/sdk';

const log = (mcpSessionId: string, message: string, data?: any) => {
  console.log(`[Adapter][Baileys->MCP][${mcpSessionId}] ${message}`, data || '');
};

/**
 * Handles the QR code update from Baileys and forwards it to the MCP client.
 * This function is intended to be called as a callback by BaileysSessionManager.
 *
 * @param mcpSessionId The MCP session ID.
 * @param qr The QR code string.
 */
export function handleBaileysQRUpdate(mcpSessionId: string, qr: string): void {
  log(mcpSessionId, 'Received QR code from Baileys.');
  McpEventEmitter.sendEventToClient(mcpSessionId, 'baileys_qr_update', { qr });
}

/**
 * Handles the Baileys connected event and notifies the MCP client.
 *
 * @param mcpSessionId The MCP session ID.
 */
export function handleBaileysConnected(mcpSessionId: string): void {
  log(mcpSessionId, 'Baileys connection established.');
  McpEventEmitter.sendEventToClient(mcpSessionId, 'baileys_event', {
    subType: 'connection_update',
    status: 'connected',
    message: 'Baileys connected successfully.'
  });
  // Potentially, here you could also send an initial presence update to the MCP client
  // McpEventEmitter.sendEventToClient(mcpSessionId, 'mcp_presence_update', { status: presencia.estado.ONLINE });
}

/**
 * Handles the Baileys disconnected event and notifies the MCP client.
 *
 * @param mcpSessionId The MCP session ID.
 * @param reason The reason for disconnection.
 */
export function handleBaileysDisconnected(mcpSessionId: string, reason: DisconnectReasonKey | undefined): void {
  const isLoggedOut = reason === DisconnectReason.loggedOut; // Use direct import
  log(mcpSessionId, `Baileys disconnected. Reason: ${reason || 'Unknown'}, Logged out: ${isLoggedOut}`);
  McpEventEmitter.sendEventToClient(mcpSessionId, 'baileys_event', {
    subType: 'connection_update',
    status: 'disconnected',
    loggedOut: isLoggedOut,
    reason: String(reason || 'Unknown') // Simpler conversion to string
  });
  // Potentially, send presence update to MCP client
  // McpEventEmitter.sendEventToClient(mcpSessionId, 'mcp_presence_update', { status: presencia.estado.OFFLINE });
}

/**
 * Handles new messages from Baileys, processes media if necessary, and forwards to the MCP client.
 *
 * @param mcpSessionId The MCP session ID.
 * @param message The Baileys WAMessage object.
 */
export async function handleNewBaileysMessage(mcpSessionId: string, message: WAMessage): Promise<void> {
  log(mcpSessionId, `New message received. ID: ${message.key.id}, From: ${message.key.remoteJid}`);

  // Basic message structure for MCP client
  // This can be expanded based on ModelContextProtocol specifications
  const mcpMessagePayload: any = {
    id: message.key.id,
    from: message.key.remoteJid,
    participant: message.key.participant, // Group message participant
    timestamp: message.messageTimestamp ? (typeof message.messageTimestamp === 'number' ? message.messageTimestamp : message.messageTimestamp.toNumber()) : Math.floor(Date.now() / 1000),
    type: 'text', // Default type
    baileysMessage: message, // Optionally include the raw message for advanced clients
  };

  // Check for different message types
  if (message.message?.conversation) {
    mcpMessagePayload.type = 'text';
    mcpMessagePayload.text = message.message.conversation;
  } else if (message.message?.extendedTextMessage) {
    mcpMessagePayload.type = 'text'; // Or 'extended_text'
    mcpMessagePayload.text = message.message.extendedTextMessage.text;
    // TODO: Handle quoted messages from extendedTextMessage.contextInfo
  } else if (
    message.message?.imageMessage ||
    message.message?.videoMessage ||
    message.message?.audioMessage ||
    message.message?.documentMessage ||
    message.message?.stickerMessage
  ) {
    log(mcpSessionId, 'Message contains media. Processing with MediaHandler...');
    // For media messages, we set a generic type first, MediaHandler will refine it
    mcpMessagePayload.type = 'media';
    const mediaInfo = await MediaHandler.downloadAndProcessMedia(mcpSessionId, message, true); // Store temporarily

    if (mediaInfo) {
      log(mcpSessionId, 'Media processed.', mediaInfo);
      mcpMessagePayload.media = {
        type: mediaInfo.type,
        mimeType: mediaInfo.mimeType,
        caption: mediaInfo.caption,
        fileName: mediaInfo.fileName,
        // filePath is for server-side use, client might get a URL or data later
        // For now, we can signal that media is available and provide details.
        // How the client accesses the media (e.g., a separate download endpoint) needs to be defined.
        // Or, for small media, we could send data directly (e.g., base64).
        // Let's assume for now we just send the metadata.
        // The actual file path should NOT be sent to the client directly for security.
        // We might need a mechanism to serve these files or convert them.
        _serverFilePath: mediaInfo.filePath, // Internal note, not for client
        error: mediaInfo.error,
      };
      mcpMessagePayload.type = mediaInfo.type || 'media'; // Refine type from mediaInfo

      // If it's a text message with media (e.g. image with caption), ensure text is also captured
      if (mediaInfo.caption && !mcpMessagePayload.text) {
          mcpMessagePayload.text = mediaInfo.caption;
      }

    } else {
      log(mcpSessionId, 'Media processing failed or no media found in message that seemed to have it.');
      mcpMessagePayload.media = { error: 'Failed to process media.' };
    }
  } else if (message.message?.reactionMessage) {
    mcpMessagePayload.type = 'reaction';
    mcpMessagePayload.reaction = {
        text: message.message.reactionMessage.text,
        targetMessageId: message.message.reactionMessage.key?.id
    };
  } else if (message.message?.locationMessage) {
    mcpMessagePayload.type = 'location';
    mcpMessagePayload.location = {
        degreesLatitude: message.message.locationMessage.degreesLatitude,
        degreesLongitude: message.message.locationMessage.degreesLongitude,
        name: message.message.locationMessage.name,
        address: message.message.locationMessage.address,
    };
  } else if (message.message?.contactMessage) {
    mcpMessagePayload.type = 'contact';
    mcpMessagePayload.contact = {
        displayName: message.message.contactMessage.displayName,
        vcard: message.message.contactMessage.vcard,
    };
  } else if (message.message?.contactsArrayMessage) {
    mcpMessagePayload.type = 'contacts_array';
    mcpMessagePayload.contacts = message.message.contactsArrayMessage.contacts?.map((c: any) => ({ // Added :any for c
        displayName: c.displayName,
        vcard: c.vcard,
    }));
  } else {
    const messageKeys = message.message ? Object.keys(message.message).join(', ') : 'null';
    log(mcpSessionId, `Unhandled Baileys message type. Keys: [${messageKeys}]`);
    mcpMessagePayload.type = 'unknown';
    mcpMessagePayload.text = `Received an unhandled message type. Content keys: ${messageKeys}`;
  }

  log(mcpSessionId, `Forwarding message to MCP client. Type: ${mcpMessagePayload.type}`);
  McpEventEmitter.sendEventToClient(mcpSessionId, 'baileys_new_message', mcpMessagePayload);

  // After sending the event, if media was stored temporarily and won't be accessed again by this flow,
  // it could be cleaned up. However, the MCP client might request it via another channel.
  // For now, let's assume cleanup happens elsewhere or after a timeout.
  // if (mcpMessagePayload.media?._serverFilePath) {
  //   MediaHandler.deleteTemporaryMediaFile(mcpMessagePayload.media._serverFilePath).catch(err => {
  //     log(mcpSessionId, `Error deleting temporary media file ${mcpMessagePayload.media._serverFilePath}: ${err.message}`);
  //   });
  // }
}

/**
 * Handles other Baileys events that might be useful for the MCP client.
 * This is a generic handler; specific handlers for common events are preferred.
 *
 * @param mcpSessionId The MCP session ID.
 * @param eventType The type of Baileys event (e.g., 'contacts.update', 'chats.upsert').
 * @param data The data associated with the event.
 */
export function handleGenericBaileysEvent(mcpSessionId: string, eventType: string, data: any): void {
  log(mcpSessionId, `Received generic Baileys event: ${eventType}`);
  McpEventEmitter.sendEventToClient(mcpSessionId, 'baileys_event', {
    subType: eventType, // e.g., 'contacts.update'
    data: data,
  });
}

// This module primarily exports functions to be used as callbacks.
// The actual Baileys event listeners will be set up in `core/baileys.ts`
// or `core/baileys-session-manager.ts`, which will then call these handlers.

log('System', 'Baileys to MCP Adapter initialized.');
