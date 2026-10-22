// Custom error types
export class EncryptionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'EncryptionError';
  }
}
