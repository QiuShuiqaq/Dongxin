export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function errorBody(code: string, message: string) {
  return {
    error: {
      code,
      message
    }
  };
}

export function publicErrorBody(statusCode: number, code: string, message: string) {
  return errorBody(code, statusCode >= 500 ? '服务暂时不可用，请稍后重试' : message);
}

