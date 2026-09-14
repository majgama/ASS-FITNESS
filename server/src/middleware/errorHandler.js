import { AppError } from '../utils/errors.js';

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: 'Rota nao encontrada.'
    }
  });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error?.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({
      error: {
        code: 'FILE_TOO_LARGE',
        message: 'Arquivo muito grande. Videos e GIFs devem ter ate 8 MB; audios, ate 3 MB.'
      }
    });
    return;
  }

  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    });
    return;
  }

  if (error?.code === '23505') {
    res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'Registro duplicado.'
      }
    });
    return;
  }

  console.error(error);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Erro interno do servidor.'
    }
  });
}
