// Stub type definitions for @whiskeysockets/baileys
// Re-structured to reflect a default export containing the main functionalities.

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
    loggedOut: string | number; // Specify if you know whether these are strings or numbers
    connectionClosed: string | number;
    connectionLost: string | number;
    connectionReplaced: string | number;
    badSession: string | number;
    removed: string | number;
    restartRequired: string | number;
    timedOut: string | number;
    [key: string]: any; // Allow other string keys for flexibility
  }

  // Type for annotating variables that will hold a specific disconnect reason *value*
  // e.g. let reasonValue: DisconnectReasonValue = baileys.DisconnectReason.loggedOut;
  // This might be overly complex; often, comparing directly (reason === baileys.DisconnectReason.loggedOut) is enough.
  // And for function parameters, string | number | undefined might be sufficient if the exact keys aren't strictly needed at type level.
  export type DisconnectReasonKey = keyof DisconnectReasonMap;


  // Interface for the main module structure exported by Baileys
  export interface BaileysModule {
    makeWASocket: (config: SocketConfig) => BaileysSocket;
    useMultiFileAuthState: (folder: string) => Promise<{ state: any; saveCreds: () => Promise<void> }>;
    downloadMediaMessage: (
      message: WAMessage,
      type: 'buffer' | 'stream',
      options?: any,
      fetchOptions?: any
    ) => Promise<Buffer | NodeJS.ReadableStream>;
    getDevice: (id: string) => any;

    // The DisconnectReason object itself, containing the actual reason values/codes
    DisconnectReason: DisconnectReasonMap;

    // Add other functions or constants exported by Baileys if needed
    // e.g. Browsers: any;
  }

  const baileys: BaileysModule;
  export default baileys; // Assume Baileys exports a default object

  // It's also common for libraries to export some types/interfaces as named exports
  // even if the main functions are on a default export.
  // So, WAMessage, SocketConfig etc. are kept as named type exports.
}
