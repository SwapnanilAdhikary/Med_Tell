import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Express } from 'express';

let server: Express | undefined;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!server) {
    const { createApp } = await import('../dist/bootstrap.js');
    const app = await createApp();
    server = app.getHttpAdapter().getInstance() as Express;
  }
  return server(req, res);
}
