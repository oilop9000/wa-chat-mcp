// Stub type definitions for @whiskeysockets/baileys
// Assuming named exports for functions and DisconnectReason object

declare module '@whiskeysockets/baileys' {
  // Define interfaces for the types we use
  export type WAMessage = any; // TODO: Define more accurately
  export type SocketConfig = any; // TODO: Define more accurately
  export type BaileysSocket = any; // TODO: Define more accurately (this is the return type of makeWASocket)
  export type ConnectionState = any; // TODO: Define more accurately
  export type BaileysEventMap = any; // TODO: Define more accurately
  export type MessageUpsertType = any; // TODO: Define more accurately
  export type MessageType = string; // e.g., 'image', 'video', etc.

  // Type definition for the DisconnectReason object's values
  export interface DisconnectReasonMap {
    loggedOut: string | number;
    connectionClosed: string | number;
    connectionLost: string | number;
    connectionReplaced: string | number;
    badSession: string | number;
    removed: string | number;
    restartRequired: string | number;
    timedOut: string | number;
    [key: string]: any;
  }

  export type DisconnectReasonKey = keyof DisconnectReasonMap;

  // Export DisconnectReason as a const object
  export const DisconnectReason: DisconnectReasonMap;

  // Export functions as named exports
  export function makeWASocket(config: SocketConfig): BaileysSocket;
  export function useMultiFileAuthState(folder: string): Promise<{ state: any; saveCreds: () => Promise<void> }>;
  export function downloadMediaMessage(
    message: WAMessage,
    type: 'buffer' | 'stream',
    options?: any,
    fetchOptions?: any
  ): Promise<Buffer | NodeJS.ReadableStream>;
  export function getDevice(id: string): any;

  // If there's a default export as well (though we might not use it with this structure)
  // const d: any;
  // export default d;
}
