// POST /signup: validate at the edge, reject unknown keys, never spread req.body into the DB.
import express from 'express';
import { z } from 'zod';

const Signup = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(128),
  name: z.string().trim().min(1).max(80),
}).strict();                                            // unknown keys such as role are an error

export function signupApp(users, hash) {
  const app = express();
  app.use(express.json({ limit: '10kb' }));
  app.post('/signup', async (req, res) => {
    const parsed = Signup.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(422).json({ error: 'Validation failed', issues: parsed.error.issues });
    const { email, password, name } = parsed.data;                // pick fields by name
    const user = await users.create({ email, passwordHash: await hash(password), name, role: 'user' });
    res.status(201).json({ id: user.id, email, name });
  });
  return app;
}
