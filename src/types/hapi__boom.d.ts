// Stub for @hapi/boom if @types/hapi__boom is not working as expected
declare module '@hapi/boom' {
  export class Boom extends Error {
    constructor(message?: string | Error, options?: BoomOptions);
    data: any;
    isBoom: boolean;
    isServer: boolean;
    message: string;
    output: BoomOutput;
    reformat: () => void;
    typeof: symbol | undefined; // This might be specific to newer versions
  }

  export interface BoomOptions {
    statusCode?: number;
    data?: any;
    decorate?: any;
    override?: boolean;
    [key: string]: any;
  }

  export interface BoomOutput {
    statusCode: number;
    headers: { [key: string]: string };
    payload: BoomPayload;
  }

  export interface BoomPayload {
    statusCode: number;
    error: string;
    message: string;
    attributes?: any;
  }

  // Add other functions if you use them e.g. badRequest, notFound etc.
  // export function badRequest(message?: string, data?: any): Boom;
  // export function notFound(message?: string, data?: any): Boom;
}
