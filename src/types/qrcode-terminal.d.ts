// Stub type definitions for qrcode-terminal

declare module 'qrcode-terminal' {
  /**
   * Generates a QR code string and prints it to the console or calls a callback.
   * @param text The text to encode into the QR code.
   * @param opts Options for QR code generation. Small is a common one.
   * @param cb Optional callback function that receives the QR code string.
   *           If not provided, QR is printed to console.
   */
  export function generate(
    text: string,
    opts?: { small?: boolean; [key: string]: any },
    cb?: (qrcodeString: string) => void
  ): void;

  /**
   * Generates a QR code and prints it directly to the terminal.
   * @param text The text to encode.
   * @param opts Options for QR code generation.
   */
  export function setErrorLevel(errorLevel: 'L' | 'M' | 'Q' | 'H'): void;

  // You can add other functions or types if you use more features of the library.
  // For example, if it has other exported functions:
  // export function anotherFunction(options: any): any;
}
