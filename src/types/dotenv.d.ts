// Stub for dotenv if @types/dotenv is not working as expected
declare module 'dotenv' {
  export interface DotenvParseOptions {
    debug?: boolean;
  }

  export interface DotenvParseOutput {
    [name: string]: string;
  }

  export interface DotenvConfigOptions extends DotenvParseOptions {
    path?: string;
    encoding?: string;
  }

  export interface DotenvConfigOutput extends DotenvParseOutput {
    error?: Error;
  }

  /**
   * Loads `.env` file contents into {@link https://nodejs.org/api/process.html#process_process_env | `process.env`}.
   * Example: 'KEY=value' becomes { KEY: 'value' } inside `process.env`.
   *
   * @param options - Accepts options for path like `overridePath` and `debug`
   * @returns An object with a `parsed` key if successful or `error` key if an error occurred.
   *
   */
  export function config(options?: DotenvConfigOptions): DotenvConfigOutput;

  /**
   * Parses a string or buffer in the .env file format into an object.
   *
   * @param src - Parses the string or buffer of a .env file format
   * @param options - Options for parsing (e.g. debug)
   * @returns An object with the parsed key-values, or an empty object if there was nothing to parse.
   */
  export function parse(src: string | Buffer, options?: DotenvParseOptions): DotenvParseOutput;
}
