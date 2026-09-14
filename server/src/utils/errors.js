export class AppError extends Error {
  constructor(message, statusCode = 400, code = 'APP_ERROR', details = undefined) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new AppError(message, 400, 'BAD_REQUEST', details);
export const unauthorized = (message = 'Autenticacao obrigatoria.') => new AppError(message, 401, 'UNAUTHORIZED');
export const forbidden = (message = 'Acesso negado.') => new AppError(message, 403, 'FORBIDDEN');
export const notFound = (message = 'Registro nao encontrado.') => new AppError(message, 404, 'NOT_FOUND');
export const paymentRequired = (message, details) => new AppError(message, 402, 'PAYMENT_REQUIRED', details);
