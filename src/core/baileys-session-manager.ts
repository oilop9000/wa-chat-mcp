import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  BaileysEventMap,
  ConnectionState,
  SocketConfig,
  WAMessage,
  MessageUpsertType,
  BaileysSocket,
  DisconnectReasonKey
} from '@whiskeysockets/baileys';
import path from 'path';
import { Boom } from '@hapi/boom';
import { unlink } from 'fs/promises'; // For deleting auth state
import qrcode from 'qrcode';
// import * as BAILEYS_MESSAGE_TYPE from '@whiskeysockets/baileys' // This line was causing the error
// We already import WAMessage which is a good general type for messages.
// Specific message content types can be accessed via message.message.imageMessage etc.

// Use BaileysSocket type directly from import

interface BaileysSession {
  mcpSessionId: string; // Link to the MCP client session
  socket: BaileysSocket;
  stateDir: string; // Directory where auth state is stored for this session
  creationTime: Date;
  lastActivityTime: Date;
  qrCode?: string; // Store the last QR code
  socketOptions?: Partial<SocketConfig>; // To store original options for re-initialization
  retryCount: number; // For reconnection attempts
}

const log = (mcpSessionId: string | null, message: string) => {
  const prefix = mcpSessionId ? `[BaileysSessMgr][${mcpSessionId}]` : `[BaileysSessMgr]`;
  console.log(`${prefix} ${message}`);
};

// In-memory store for Baileys sessions. Keyed by MCP Session ID.
export const baileysSessions = new Map<string, BaileysSession>();

const AUTH_STATE_BASE_DIR = path.join(process.cwd(), '.baileys_auth_state');

/**
 * Creates or retrieves an existing Baileys socket/instance for a given MCP session ID.
 *
 * @param mcpSessionId The MCP session ID to associate with this Baileys instance.
 * @param options Optional configuration for the Baileys socket.
 * @param eventCallbacks Callbacks for Baileys events specific to this session.
 *                       (e.g., onQR, onMessage, onDisconnect)
 * @returns The BaileysSocket instance.
 */
export async function getOrCreateBaileysSession(
  mcpSessionId: string,
  eventCallbacks: {
    onQR: (qr: string) => void;
    onConnected: () => void;
    onDisconnected: (reason: DisconnectReasonKey | undefined, mcpSessionId: string) => void;
    onMessage: (message: WAMessage, mcpSessionId: string) => void;
    // Add other event callbacks as needed
  },
  options?: Partial<SocketConfig>
): Promise<BaileysSocket> {
  if (baileysSessions.has(mcpSessionId)) {
    const existingSession = baileysSessions.get(mcpSessionId)!;
    log(mcpSessionId, 'Returning existing Baileys socket.');
    existingSession.lastActivityTime = new Date();
    if (existingSession.qrCode && (existingSession.socket as any).ws?.readyState !== (existingSession.socket as any).ws?.OPEN) {
      eventCallbacks.onQR(existingSession.qrCode);
    }
    return existingSession.socket;
  }

  log(mcpSessionId, 'Creating new Baileys socket...');
  const stateDir = path.join(AUTH_STATE_BASE_DIR, `session_${mcpSessionId}`);
  const { state, saveCreds } = await useMultiFileAuthState(stateDir); // Use direct import

  const minimalBaileysLogger = {
    info: (...args: any[]) => console.log('[Baileys INFO]', ...args),
    error: (...args: any[]) => console.error('[Baileys ERROR]', ...args),
    warn: (...args: any[]) => console.warn('[Baileys WARN]', ...args),
    debug: (...args: any[]) => { }, // console.log('[Baileys DEBUG]', ...args), // Disabled debug for less verbosity
    trace: (...args: any[]) => { }, // console.log('[Baileys TRACE]', ...args),
    fatal: (...args: any[]) => console.error('[Baileys FATAL]', ...args),
    child: () => minimalBaileysLogger, // child() devuelve el mismo logger
  };

  const socketConfig: SocketConfig = {
    auth: state,
    printQRInTerminal: false,
    logger: minimalBaileysLogger as any, // 'as any' para que coincida con el tipo SocketConfig del stub
    ...options,
  };

  const sock: BaileysSocket = makeWASocket(socketConfig); // Use direct import

  const newBaileysSession: BaileysSession = {
    mcpSessionId,
    socket: sock,
    stateDir,
    creationTime: new Date(),
    lastActivityTime: new Date(),
    socketOptions: options, // Store original options
    retryCount: 0, // Initialize retry count
  };
  baileysSessions.set(mcpSessionId, newBaileysSession);

  // Register event handlers
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update: Partial<ConnectionState>) => { // Changed pkgBaileys.ConnectionState to ConnectionState
    const { connection, lastDisconnect, qr } = update;
    newBaileysSession.lastActivityTime = new Date();

    if (qr) {
      log(mcpSessionId, 'QR code received. Attempting to display directly in server console...');
      try {
        qrcode.toString(qr, { type: 'terminal', small: true }, (err, url) => {
          if (err) {
            console.error('[qrcode.toString] Error during QR generation for console:', err.message);
            return;
          }
          console.log(url);
          console.log('<<<<< QR Code should be above this line >>>>>');
        });
      } catch (e: any) {
        console.error('[qrcode.toString] Error during QR generation for console:', e.message);
      }
      newBaileysSession.qrCode = qr;
      eventCallbacks.onQR(qr); // Still send via SSE for any connected client
    }

    if (connection === 'close') {
      const boomError = lastDisconnect?.error as Boom;
      const isLoggedOut = boomError?.output?.statusCode === DisconnectReason.loggedOut;
      // Prioritize specific error message for restart, then status code 515
      const isRestartRequired = boomError?.message.includes('Stream Errored (restart required)') ||
        boomError?.output?.statusCode === 515;

      log(mcpSessionId, `Connection closed. Error: ${boomError?.message || 'No error object'}, Baileys Reason: ${lastDisconnect?.reason}, LoggedOut: ${isLoggedOut}, RestartRequired: ${isRestartRequired}`);
      eventCallbacks.onDisconnected(lastDisconnect?.reason as DisconnectReasonKey, mcpSessionId);

      if (isLoggedOut) {
        log(mcpSessionId, 'Logged out. Cleaning up auth state.');
        removeBaileysSession(mcpSessionId, true); // true to delete auth state
      } else if (isRestartRequired) {
        const currentSession = baileysSessions.get(mcpSessionId);
        if (currentSession) {
          const MAX_RETRIES = 3;
          const RETRY_DELAY_MS = 3000; // 3 seconds

          if (currentSession.retryCount < MAX_RETRIES) {
            currentSession.retryCount++;
            log(mcpSessionId, `Restart required. Attempting re-initialization (Attempt ${currentSession.retryCount}/${MAX_RETRIES}). Delaying for ${RETRY_DELAY_MS}ms...`);

            // Important: update the session in the map with the new retryCount *before* the async delay
            baileysSessions.set(mcpSessionId, currentSession);

            setTimeout(() => {
              // Remove the "bad" session entry just before trying to create a new one
              // This ensures getOrCreateBaileysSession doesn't just return the closed socket instance
              baileysSessions.delete(mcpSessionId);
              log(mcpSessionId, `Removed old session map entry for ${mcpSessionId}. Re-creating...`);

              getOrCreateBaileysSession(mcpSessionId, eventCallbacks, currentSession.socketOptions)
                .then(() => log(mcpSessionId, `Re-initialization attempt ${currentSession.retryCount} successful.`))
                .catch(err => {
                  log(mcpSessionId, `Failed to re-initialize (Attempt ${currentSession.retryCount}): ${err instanceof Error ? err.message : String(err)}`);
                  // If re-creation fails, the session remains deleted from the map.
                  // Client would need to trigger /mcp/session/init again.
                });
            }, RETRY_DELAY_MS);
          } else {
            log(mcpSessionId, `Restart required, but max retries (${MAX_RETRIES}) reached for session ${mcpSessionId}. Not attempting further re-initialization. Please try initializing the session again manually if needed.`);
            // Optionally, fully remove the session here if max retries are hit, including auth state,
            // or leave it for manual cleanup / next stale session cleanup.
            // For now, just stop retrying. The session is already out of the map from the last attempt or will be.
          }
        } else {
          log(mcpSessionId, `Restart required, but session ${mcpSessionId} not found in map. Cannot proceed with re-initialization.`);
        }
      } else {
        // Other 'close' events where it's not a logout and not an explicit restart required.
        // Baileys might handle reconnection internally, or it might be a final closure.
        log(mcpSessionId, `Connection closed (not logout, not restart_required). Baileys might auto-reconnect or session ended. Error: ${boomError?.message}`);
        // Consider if any cleanup is needed here, e.g. removing from map but not auth state.
        // For now, let Baileys handle it or wait for stale session cleanup.
      }
    } else if (connection === 'open') {
      log(mcpSessionId, 'Connection opened successfully.');
      if (baileysSessions.has(mcpSessionId)) { // Session might have been re-created
        const currentSession = baileysSessions.get(mcpSessionId)!;
        currentSession.retryCount = 0; // Reset retry count on successful connection
        baileysSessions.set(mcpSessionId, currentSession); // Update session in map
        log(mcpSessionId, 'Retry count reset.');
      }
      newBaileysSession.qrCode = undefined; // Clear QR once connected (newBaileysSession might be stale here if reconnected)
      const sessionToClearQR = baileysSessions.get(mcpSessionId);
      if (sessionToClearQR) sessionToClearQR.qrCode = undefined;

      eventCallbacks.onConnected();
    }
  });

  sock.ev.on('messages.upsert', (m: { messages: WAMessage[], type: MessageUpsertType }) => { // Changed pkgBaileys.MessageUpsertType to MessageUpsertType
    // log(mcpSessionId, `New message upsert: ${JSON.stringify(m)}`);
    if (m.messages && m.messages.length > 0) {
      // We typically care about new messages that are not from oneself and have actual content
      m.messages.forEach((msg: WAMessage) => {
        if (msg.message && !msg.key.fromMe) { // Process if message exists and not from self
          eventCallbacks.onMessage(msg, mcpSessionId);
        }
      });
    }
  });

  // Add more event listeners as needed:
  // sock.ev.on('contacts.upsert', ...)
  // sock.ev.on('chats.update', ...)
  // sock.ev.on('presence.update', ...)

  log(mcpSessionId, 'Baileys socket created and event handlers registered.');
  return sock;
}

/**
 * Retrieves an existing Baileys socket for a given MCP session ID.
 * @param mcpSessionId The MCP session ID.
 * @returns The BaileysSocket instance or undefined if not found.
 */
export function getBaileysSocket(mcpSessionId: string): BaileysSocket | undefined {
  const session = baileysSessions.get(mcpSessionId);
  if (session) {
    session.lastActivityTime = new Date();
    return session.socket;
  }
  return undefined;
}

/**
 * Removes and disconnects a Baileys session.
 * @param mcpSessionId The MCP session ID.
 * @param deleteAuthState If true, deletes the authentication state files.
 */
export async function removeBaileysSession(mcpSessionId: string, deleteAuthState: boolean = false): Promise<void> {
  const session = baileysSessions.get(mcpSessionId);
  if (session) {
    log(mcpSessionId, `Removing Baileys session. Delete auth state: ${deleteAuthState}`);
    try {
      // Attempt to gracefully close the socket connection
      // session.socket.ws?.close(); // This might be too abrupt
      await session.socket.logout(); // Preferred way to close and clean up
      log(mcpSessionId, 'Socket logout initiated.');
    } catch (error) {
      log(mcpSessionId, `Error during socket logout/close: ${error instanceof Error ? error.message : String(error)}`);
      // If logout fails or isn't available (e.g., socket not fully initialized),
      // ensure physical connection is terminated if possible.
      session.socket.end(undefined); // Pass undefined or an Error object
    }


    if (deleteAuthState) {
      try {
        // fs.rm with force and recursive is safer for directories
        // await rm(session.stateDir, { recursive: true, force: true });
        // Baileys does not directly expose a single command to delete all files by useMultiFileAuthState.
        // We need to manually list and delete them or remove the directory.
        // For simplicity, we'll try to remove the directory.
        // This requires careful handling in production (permissions, non-empty dirs).
        // A more robust way would be to track files created by useMultiFileAuthState if possible.
        // For now, we assume stateDir is the directory itself.
        // Ensure the directory exists before trying to remove it.
        const fs = require('fs').promises;
        try {
          await fs.rm(session.stateDir, { recursive: true, force: true });
          log(mcpSessionId, `Auth state directory ${session.stateDir} removed.`);
        } catch (rmError: any) {
          // ENOENT means directory doesn't exist, which is fine if we're cleaning up.
          if (rmError.code !== 'ENOENT') {
            log(mcpSessionId, `Error removing auth state directory ${session.stateDir}: ${rmError.message}`);
          } else {
            log(mcpSessionId, `Auth state directory ${session.stateDir} not found, no removal needed.`);
          }
        }
      } catch (err) {
        log(mcpSessionId, `Error deleting auth state for session ${mcpSessionId} at ${session.stateDir}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    baileysSessions.delete(mcpSessionId);
    log(mcpSessionId, 'Baileys session removed from map.');
  } else {
    log(null, `Attempted to remove non-existent Baileys session: ${mcpSessionId}`);
  }
}

/**
 * Cleans up inactive Baileys sessions.
 * @param maxIdleTimeMs Maximum idle time in milliseconds.
 */
export async function cleanupInactiveBaileysSessions(maxIdleTimeMs: number = 30 * 60 * 1000): Promise<void> { // Default 30 minutes
  const now = new Date().getTime();
  log(null, 'Running cleanup for inactive Baileys sessions...');
  for (const [mcpSessionId, session] of baileysSessions.entries()) {
    if (now - session.lastActivityTime.getTime() > maxIdleTimeMs) {
      log(mcpSessionId, `Session inactive for too long. Cleaning up. Last activity: ${session.lastActivityTime.toISOString()}`);
      // Decide whether to delete auth state for inactive sessions.
      // Usually, you might want to keep it unless explicitly logged out or very old.
      await removeBaileysSession(mcpSessionId, false); // Default to NOT deleting auth state for inactivity
    }
  }
}

// Create the base directory for auth states if it doesn't exist
// This should be done once at startup.
import fs from 'fs';
if (!fs.existsSync(AUTH_STATE_BASE_DIR)) {
  fs.mkdirSync(AUTH_STATE_BASE_DIR, { recursive: true });
  console.log(`[BaileysSessMgr] Created base auth state directory: ${AUTH_STATE_BASE_DIR}`);
}

// Example of periodic cleanup (should be initiated from the main application logic)
// setInterval(() => cleanupInactiveBaileysSessions(), 15 * 60 * 1000); // Every 15 minutes

log(null, 'Baileys Session Manager initialized.');
