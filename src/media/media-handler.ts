import {
    WAMessage,
    MessageType,
    downloadMediaMessage,
    getDevice
} from '@whiskeysockets/baileys';
import { writeFile, readFile, unlink } from 'fs/promises';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import * as BaileysSessionManager from '../core/baileys-session-manager'; // To get socket for sending

const log = (mcpSessionId: string | null, message: string) => {
  const prefix = mcpSessionId ? `[MediaHandler][${mcpSessionId}]` : `[MediaHandler]`;
  console.log(`${prefix} ${message}`);
};

const TEMP_MEDIA_DIR = path.join(os.tmpdir(), 'mcp_baileys_media');

// Ensure temp directory exists
import fs from 'fs';
if (!fs.existsSync(TEMP_MEDIA_DIR)) {
  fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
  log(null, `Created temporary media directory: ${TEMP_MEDIA_DIR}`);
}

export interface ProcessedMediaInfo {
  type: 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'unknown';
  mimeType: string;
  data?: Buffer; // Raw data, e.g., for direct forwarding or small files
  filePath?: string; // Path to a temporarily stored file
  fileName?: string; // Original or generated file name
  url?: string; // If Baileys provides a direct URL (less common for received media)
  caption?: string;
  error?: string;
}

/**
 * Downloads media from a Baileys message and processes it.
 *
 * @param mcpSessionId The MCP session ID, for logging and context.
 * @param message The Baileys WAMessage containing the media.
 * @param storeTemporarily If true, stores the media in a temporary file and returns filePath.
 *                         Otherwise, returns data as a Buffer if possible.
 * @returns A Promise resolving to ProcessedMediaInfo or null if no media found or error.
 */
export async function downloadAndProcessMedia(
  mcpSessionId: string,
  message: WAMessage,
  storeTemporarily: boolean = true
): Promise<ProcessedMediaInfo | null> {
  let messageType: MessageType | undefined | any; // Allow any for property access
  let mediaKey: Uint8Array | undefined;
  let url: string | undefined;
  let caption: string | undefined;
  let originalFileName: string | undefined;

  if (message.message?.imageMessage) {
    messageType = 'image';
    mediaKey = message.message.imageMessage.mediaKey!;
    url = message.message.imageMessage.url!;
    caption = message.message.imageMessage.caption;
    originalFileName = message.message.imageMessage.fileName || `${uuidv4()}.jpg`;
  } else if (message.message?.videoMessage) {
    messageType = 'video';
    mediaKey = message.message.videoMessage.mediaKey!;
    url = message.message.videoMessage.url!;
    caption = message.message.videoMessage.caption;
    originalFileName = message.message.videoMessage.fileName || `${uuidv4()}.mp4`;
  } else if (message.message?.audioMessage) {
    messageType = 'audio';
    mediaKey = message.message.audioMessage.mediaKey!;
    url = message.message.audioMessage.url!;
    originalFileName = `${uuidv4()}.ogg`; // Baileys often sends audio as ogg
  } else if (message.message?.documentMessage) {
    messageType = 'document';
    mediaKey = message.message.documentMessage.mediaKey!;
    url = message.message.documentMessage.url!;
    caption = message.message.documentMessage.caption; // caption for document? title is more common
    originalFileName = message.message.documentMessage.fileName || `${uuidv4()}.bin`;
  } else if (message.message?.stickerMessage) {
    messageType = 'sticker';
    mediaKey = message.message.stickerMessage.mediaKey!;
    url = message.message.stickerMessage.url!;
    originalFileName = `${uuidv4()}.webp`;
  } else {
    log(mcpSessionId, 'Message does not contain known media type for download.');
    return null;
  }

  if (!mediaKey || !url) {
    log(mcpSessionId, `Media key or URL missing for message type ${messageType}.`);
    return {
        type: messageType || 'unknown',
        mimeType: '', // Unknown at this point
        error: 'Media key or URL missing from Baileys message.'
    };
  }

  const mimeType = message.message?.[`${messageType}Message` as keyof typeof message.message]?.mimetype || '';

  try {
    log(mcpSessionId, `Attempting to download ${messageType} (MIME: ${mimeType || 'N/A'}). Name: ${originalFileName}`);
    const downloadedMedia = await downloadMediaMessage( // use direct import
      message,
      'buffer',
      {},
      {
        logger: { info: () => {}, error: console.error, warn: console.warn, debug: () => {} } as any,
      }
    );

    if (!(downloadedMedia instanceof Buffer)) {
        // Handle cases where it might be a stream if type was 'stream' or if API changes
        throw new Error('Downloaded media is not a Buffer as expected.');
    }
    const buffer: Buffer = downloadedMedia;


    log(mcpSessionId, `${messageType} downloaded successfully. Size: ${buffer.length} bytes.`);

    const processedInfo: ProcessedMediaInfo = {
      type: messageType as ProcessedMediaInfo['type'], // Already checked it's a known type
      mimeType,
      caption,
      fileName: originalFileName,
    };

    if (storeTemporarily) {
      const tempFilePath = path.join(TEMP_MEDIA_DIR, originalFileName || `${uuidv4()}.${mimeType?.split('/')[1] || 'bin'}`);
      await writeFile(tempFilePath, buffer);
      processedInfo.filePath = tempFilePath;
      log(mcpSessionId, `Media stored temporarily at: ${tempFilePath}`);
    } else {
      processedInfo.data = buffer;
    }

    return processedInfo;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(mcpSessionId, `Error downloading or processing media: ${errorMessage}`);
    return {
      type: messageType as ProcessedMediaInfo['type'],
      mimeType,
      fileName: originalFileName,
      error: `Failed to download/process media: ${errorMessage}`,
    };
  }
}


/**
 * Prepares media content for sending via Baileys.
 * This could involve fetching from a URL, reading from a local path, or using a buffer.
 *
 * @param mcpSessionId The MCP session ID for context.
 * @param mediaSource The source of the media: a URL, a local file path, or a Buffer.
 * @param messageType The type of media to send.
 * @param recipientJid The JID of the recipient.
 * @param caption Optional caption for the media.
 * @param originalFileName Optional original filename, useful for documents.
 * @returns A Promise resolving to the Baileys message content for sending, or throws an error.
 */
export async function prepareMediaForSending(
  mcpSessionId: string,
  mediaSource: string | Buffer, // URL, local file path, or Buffer
  messageType: 'image' | 'video' | 'audio' | 'document' | 'sticker',
  // recipientJid: string, // Not needed here, but good for context if this function also sent
  caption?: string,
  originalFileName?: string,
  mimetype?: string,
): Promise<any> { // Returns the object Baileys expects for media messages, e.g., { image: Buffer, caption: string }
  log(mcpSessionId, `Preparing ${messageType} for sending. Source type: ${typeof mediaSource}`);
  let mediaBuffer: Buffer;

  if (typeof mediaSource === 'string') {
    // Assume it's a URL or local file path
    if (mediaSource.startsWith('http://') || mediaSource.startsWith('https://')) {
      // Download from URL
      log(mcpSessionId, `Fetching media from URL: ${mediaSource}`);
      const response = await fetch(mediaSource);
      if (!response.ok) {
        throw new Error(`Failed to fetch media from URL ${mediaSource}: ${response.statusText}`);
      }
      mediaBuffer = Buffer.from(await response.arrayBuffer());
      log(mcpSessionId, `Fetched ${mediaBuffer.length} bytes from URL.`);
    } else {
      // Read from local file path
      log(mcpSessionId, `Reading media from local file: ${mediaSource}`);
      mediaBuffer = await readFile(mediaSource);
      log(mcpSessionId, `Read ${mediaBuffer.length} bytes from file.`);
      if (!originalFileName) {
        originalFileName = path.basename(mediaSource);
      }
    }
  } else if (Buffer.isBuffer(mediaSource)) {
    mediaBuffer = mediaSource;
    log(mcpSessionId, `Using provided Buffer of ${mediaBuffer.length} bytes.`);
  } else {
    throw new Error('Invalid mediaSource: must be a URL string, file path string, or a Buffer.');
  }

  const content: any = { caption }; // Common part

  switch (messageType) {
    case 'image':
      content.image = mediaBuffer;
      if (mimetype) content.mimetype = mimetype;
      break;
    case 'video':
      content.video = mediaBuffer;
      if (mimetype) content.mimetype = mimetype;
      // content.gifPlayback = options.gifPlayback || false; // Example for video options
      break;
    case 'audio':
      content.audio = mediaBuffer;
      content.mimetype = mimetype || 'audio/mp4'; // Or 'audio/ogg; codecs=opus' if opus
      // content.ptt = options.ptt || false; // For voice notes
      break;
    case 'document':
      content.document = mediaBuffer;
      content.mimetype = mimetype || 'application/octet-stream'; // Provide a sensible default or determine from filename
      content.fileName = originalFileName || 'file.bin';
      break;
    case 'sticker':
      content.sticker = mediaBuffer; // Sticker expects a WebP buffer
      // content.pack = ... // Optional: sticker pack metadata
      // content.author = ...
      break;
    default:
      throw new Error(`Unsupported media type for sending: ${messageType}`);
  }

  log(mcpSessionId, `Media prepared for Baileys: ${JSON.stringify(Object.keys(content))}`);
  return content;
}


/**
 * Deletes a temporarily stored media file.
 * @param filePath The path to the temporary file.
 */
export async function deleteTemporaryMediaFile(filePath: string): Promise<void> {
  // Basic security check: ensure the file is within the designated temp media directory
  if (!path.resolve(filePath).startsWith(path.resolve(TEMP_MEDIA_DIR))) {
    console.error(`[MediaHandler] Attempt to delete file outside temp directory: ${filePath}`);
    throw new Error('Invalid file path for deletion.');
  }

  try {
    await unlink(filePath);
    log(null, `Temporary media file deleted: ${filePath}`);
  } catch (error: any) {
    // If file doesn't exist, it might have been cleaned up already, which is fine.
    if (error.code !== 'ENOENT') {
      log(null, `Error deleting temporary media file ${filePath}: ${error.message}`);
      throw error; // Re-throw other errors
    }
  }
}

// Example of how this might be used (conceptual, actual calls are from baileys.ts or adapter)
/*
async function exampleUsage(mcpSessionId: string, message: WAMessage) {
  const mediaInfo = await downloadAndProcessMedia(mcpSessionId, message);
  if (mediaInfo && mediaInfo.filePath) {
    console.log('Media downloaded to:', mediaInfo.filePath);
    // Send mediaInfo to MCP client...
    // Later, cleanup:
    // await deleteTemporaryMediaFile(mediaInfo.filePath);
  } else if (mediaInfo && mediaInfo.data) {
    console.log('Media downloaded to buffer, size:', mediaInfo.data.length);
    // Send mediaInfo (with data or a representation of it) to MCP client...
  }

  // Example sending
  // const socket = BaileysSessionManager.getBaileysSocket(mcpSessionId);
  // if (socket) {
  //   const mediaContent = await prepareMediaForSending(mcpSessionId, 'path/to/your/image.jpg', 'image', 'Hello from media handler!');
  //   await socket.sendMessage('recipient_jid@s.whatsapp.net', mediaContent);
  // }
}
*/

log(null, 'Media Handler initialized.');
