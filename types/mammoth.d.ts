declare module 'mammoth' {
  interface Result {
    value: string;
    messages: unknown[];
  }
  export function extractRawText(options: { path: string }): Promise<Result>;
}
