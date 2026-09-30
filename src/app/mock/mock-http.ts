/** Lo que recibe un handler: el request ya desarmado. */
export interface MockRequest {
  method: string;
  /** Path relativo a `apiUrl`, sin query (`/brand/paginate`). */
  path: string;
  /** Path con query, tal como se grabó en el dump (`/stock/expirations?page=0&size=25`). */
  pathWithQuery: string;
  params: URLSearchParams;
  body: unknown;
  headers: { get(name: string): string | null };
}

export interface MockReply {
  status: number;
  body: unknown;
}

export class MockError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string,
    message: string,
    readonly data: Record<string, unknown> | null = null,
  ) {
    super(message);
  }
}

export function ok(body: unknown, status = 200): MockReply {
  return { status, body };
}

export function fail(status: number, errorCode: string, message: string, data?: Record<string, unknown>): never {
  throw new MockError(status, errorCode, message, data ?? null);
}

/** Cuerpo de error con la forma de `CustomRestExceptionHandler` (ver `ApiErrorBody`). */
export function errorBody(error: MockError): Record<string, unknown> {
  return {
    status: String(error.status),
    errorCode: error.errorCode,
    userMessage: error.message,
    developerMessage: `[mock] ${error.message}`,
    message: error.message,
    localizedMessage: error.message,
    data: error.data,
    localTime: new Date().toISOString(),
  };
}

export type MockHandler = (req: MockRequest, match: RegExpExecArray) => MockReply | null;

export interface MockRoute {
  method: string;
  pattern: RegExp;
  handle: MockHandler;
}

export function route(method: string, pattern: string | RegExp, handle: MockHandler): MockRoute {
  const regex =
    typeof pattern === 'string'
      ? new RegExp(`^${pattern.replace(/:[a-zA-Z]+/g, '([^/]+)')}$`)
      : pattern;
  return { method, pattern: regex, handle };
}
