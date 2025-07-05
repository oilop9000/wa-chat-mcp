// Stub type definitions for @modelcontextprotocol/sdk
// This is a minimal set of declarations to make the TypeScript compiler happy.

declare module '@modelcontextprotocol/sdk' {
  // Declare the 'presencia' object or namespace and its properties/types
  export const presencia: {
    estado: {
      ONLINE: string; // Or number, or specific enum type
      OFFLINE: string;
      // Add other presence states if they exist
      [key: string]: any; // Allow other string keys if it's an object
    };
    // Add other exports from 'presencia' if used
  };

  // Declare other exports from the SDK that your project uses
  // export class ModelContext { ... }
  // export function anotherFunction(options: any): any;

  // If the entire SDK is exported as a default object from which you destructure:
  // const sdkInstance: any;
  // export default sdkInstance;
}
