// Durable outbox enqueue, separated from chat.ts so the copy→persist→fence flow is
// directly testable. On any failure the owned copy is removed and the caller gets a
// friendly typed error — the composer keeps the draft, nothing is silently queued.
import type { OutboxItem } from './types.ts';
import { adoptOutboxFile, deleteOwnedOutboxFile, type OutboxFs } from './outboxstore.ts';

export class SendError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface EnqueueDeps {
  fs: OutboxFs;
  alive(): boolean;
  writeOutbox(item: OutboxItem): Promise<unknown>;
}

export async function enqueueOutgoing(item: OutboxItem, deps: EnqueueDeps): Promise<OutboxItem> {
  if (item.uri) {
    try {
      item.uri = await adoptOutboxFile(deps.fs, item.uri, item.client_id);
    } catch {
      throw new SendError('attach_failed', 'Could not attach that file. Please try again or pick a different one.');
    }
  }
  if (!deps.alive()) {
    await deleteOwnedOutboxFile(deps.fs, item.uri);
    throw new SendError('no_session', 'You are signed out. Sign in again to send.');
  }
  try {
    await deps.writeOutbox(item);
  } catch {
    await deleteOwnedOutboxFile(deps.fs, item.uri);
    throw new SendError('queue_failed', 'Could not save the message on this device. Please try again.');
  }
  if (!deps.alive()) {
    await deleteOwnedOutboxFile(deps.fs, item.uri);
    throw new SendError('no_session', 'You are signed out. Sign in again to send.');
  }
  return item;
}
