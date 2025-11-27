export type DomainErrorCode =
  | "invalid_request"
  | "not_found"
  | "conflict"
  | "internal_error";

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class CommandError extends DomainError {
  constructor(message: string, details?: unknown) {
    super("invalid_request", message, details);
    this.name = "CommandError";
  }
}

export class StateFailureError extends DomainError {
  constructor(message: string, details?: unknown) {
    super("internal_error", message, details);
    this.name = "StateFailureError";
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string, details?: unknown) {
    super("not_found", message, details);
    this.name = "NotFoundError";
  }
}

export class InvalidRequestError extends DomainError {
  constructor(message: string, details?: unknown) {
    super("invalid_request", message, details);
    this.name = "InvalidRequestError";
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: unknown) {
    super("conflict", message, details);
    this.name = "ConflictError";
  }
}

export function asDomainError(error: unknown): DomainError | null {
  if (error instanceof DomainError) return error;
  return null;
}
