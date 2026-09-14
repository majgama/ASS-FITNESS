import { Router } from 'express';
import { z } from 'zod';
import { authRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { emailSchema, parseBody, passwordSchema } from '../utils/validators.js';
import { loginUser, logoutSession, registerUser } from '../services/authService.js';

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().trim().min(2),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(['personal', 'student']).default('personal'),
  dateOfBirth: z.string().optional().nullable(),
  cref: z.string().trim().optional().nullable(),
  specialty: z.string().trim().optional().nullable(),
  inviteCode: z.string().trim().optional().nullable(),
  objective: z.string().trim().optional().nullable(),
  startDate: z.string().optional().nullable(),
  restrictions: z.string().trim().optional().nullable(),
  nextAssessmentDate: z.string().optional().nullable()
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1)
});

authRouter.post('/register', asyncHandler(async (req, res) => {
  const payload = parseBody(registerSchema, req.body);
  const user = await registerUser(payload);
  res.status(201).json({ user });
}));

authRouter.post('/login', asyncHandler(async (req, res) => {
  const payload = parseBody(loginSchema, req.body);
  const result = await loginUser({
    ...payload,
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip
  });
  res.json(result);
}));

authRouter.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user });
});

authRouter.post('/logout', authRequired, asyncHandler(async (req, res) => {
  await logoutSession(req.session.id);
  res.status(204).send();
}));
