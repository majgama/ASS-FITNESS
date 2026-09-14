import { Router } from 'express';
import { processHotmartWebhook } from '../services/paymentService.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const paymentsRouter = Router();

paymentsRouter.post('/hotmart/webhook', asyncHandler(async (req, res) => {
  const result = await processHotmartWebhook(req.headers, req.body);
  res.json(result);
}));
