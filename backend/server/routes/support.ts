import express from 'express';

import { ok, sendError } from '../response';
import { createSupportRequest } from '../supportRequests';

const router = express.Router();

router.post('/', (req, res) => {
  const { name, email, subject, message, userId, priority } = req.body as {
    name?: string;
    email?: string;
    subject?: string;
    message?: string;
    userId?: string;
    priority?: 'low' | 'medium' | 'high';
  };

  if (!name?.trim() || !email?.trim() || !subject?.trim() || !message?.trim()) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'name, email, subject, and message are required',
    );
  }

  const ticket = createSupportRequest({
    name: name.trim(),
    email: email.trim(),
    subject: subject.trim(),
    message: message.trim(),
    userId: userId?.trim() || undefined,
    priority,
  });

  return res.status(201).json(ok(ticket, 'Support request submitted'));
});

export default router;
