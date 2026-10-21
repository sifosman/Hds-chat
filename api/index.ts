import type { IncomingMessage, ServerResponse } from 'node:http';
import { router } from '../server/routes.js';

export const config = { maxDuration: 60 };

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await router.handle(req, res);
}
