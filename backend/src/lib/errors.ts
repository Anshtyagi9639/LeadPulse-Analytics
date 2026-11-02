import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { logger } from './logger.js';

/** Error with an HTTP status and a stable machine-readable code. Messages are shown to users; never include PII. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } } satisfies ErrorBody);
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let body: ErrorBody = { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } };

  if (err instanceof AppError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, details: err.details } };
  } else if (err instanceof ZodError) {
    status = 400;
    body = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request is invalid.',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    };
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const messages: Record<string, string> = {
      LIMIT_FILE_SIZE: 'A file exceeds the maximum upload size.',
      LIMIT_FILE_COUNT: 'Too many files in one upload.',
      LIMIT_UNEXPECTED_FILE: 'Unexpected upload field. Use the "files" field.',
    };
    body = { error: { code: err.code, message: messages[err.code] ?? 'Upload rejected.' } };
  } else if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.too.large') {
    status = 413;
    body = { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } };
  } else if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
    status = 400;
    body = { error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' } };
  }

  if (status >= 500) {
    // Log the error type and stack only — never request bodies or file contents.
    logger.error('request_failed', { method: req.method, path: req.route?.path ?? 'unknown', status, error: err instanceof Error ? err.stack : String(err) });
  }
  res.status(status).json(body);
};
