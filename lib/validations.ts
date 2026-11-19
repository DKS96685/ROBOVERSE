import { z } from 'zod';

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Identifier is required'),
  password: z.string().min(1, 'Password is required'),
});

export const teamCreateSchema = z.object({
  name: z.string().trim().min(2, 'Team name must be at least 2 characters').max(50),
  loginId: z
    .string()
    .trim()
    .min(3, 'Login ID must be at least 3 characters')
    .max(30, 'Login ID must be at most 30 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Login ID can only contain letters, numbers, underscores, and hyphens'),
  password: z.string().min(6, 'Password must be at least 6 characters').max(100),
  projectId: z.string().uuid().nullable().optional(),
  members: z
    .array(z.string().trim().min(1, 'Member name cannot be empty'))
    .length(3, 'Each team must have exactly 3 members'),
});

export const teamUpdateSchema = z.object({
  teamId: z.string().uuid(),
  name: z.string().trim().min(2).max(50).optional(),
  active: z.boolean().optional(),
  projectId: z.string().uuid().nullable().optional(),
  members: z
    .array(z.string().trim().min(1))
    .length(3, 'Each team must have exactly 3 members')
    .optional(),
  password: z.string().min(6, 'Password must be at least 6 characters').optional(),
});

export const projectCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().min(1).max(5000),
  snakeHint: z.string().trim().max(2000).optional(),
  pongHint: z.string().trim().max(2000).optional(),
  memoryHint: z.string().trim().max(2000).optional(),
  hints: z.array(z.object({
    gameId: z.string().uuid(),
    clueText: z.string().trim().max(2000),
  })).optional(),
});

export const projectUpdateSchema = projectCreateSchema.extend({
  projectId: z.string().uuid(),
});

export const gameUpdateSchema = z.object({
  gameId: z.string().uuid(),
  clueText: z.string().trim(),
  minSeconds: z.number().int().min(5).max(180).optional(),
  enabled: z.boolean().optional(),
  orderNum: z.number().int().min(1).max(3).optional(),
});

export const gameStartSchema = z.object({
  gameId: z.string().uuid(),
});

export const gameSubmitSchema = z.object({
  sessionId: z.string().uuid(),
  result: z.enum(['won', 'lost']),
});

export const adminPasswordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export const resetEventSchema = z.object({
  confirmation: z.literal('RESET', {
    error: 'You must type RESET to confirm data purge',
  }),
});
