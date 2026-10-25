// Durable storage for outgoing attachments. Expo's cache directory may be purged by
// the OS, which would strand queued media, so every send copies its source into
// documentDirectory/outbox-media/ first and the outbox persists only that owned path.
// Deletion is strictly name-checked per file: we only ever remove files we created —
// never picker sources, never the directory itself, never foreign or traversal paths.
export const OUTBOX_DIR = 'outbox-media/';

// Owned names look like "<client_id>.<ext>" — conservative charset, no separators.
const OWNED_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{1,127}(\.[A-Za-z0-9]{1,8})?$/;

export interface OutboxFs {
  documentDirectory: string | null;
  makeDirectoryAsync(path: string, opts?: { intermediates?: boolean }): Promise<unknown>;
  readDirectoryAsync?(path: string): Promise<string[]>;
  copyAsync(opts: { from: string; to: string }): Promise<unknown>;
  deleteAsync(path: string, opts?: { idempotent?: boolean }): Promise<unknown>;
}

function dir(fs: OutboxFs): string {
  if (!fs.documentDirectory) throw new Error('no_document_directory');
  return fs.documentDirectory.replace(/\/?$/, '/') + OUTBOX_DIR;
}

const safeExt = (uri: string) => uri.split('?')[0].match(/\.[A-Za-z0-9]{1,8}$/)?.[0] || '';

export function isOwnedOutboxUri(fs: OutboxFs, uri: string | undefined | null): uri is string {
  if (!uri || !fs.documentDirectory) return false;
  let base: string;
  try { base = dir(fs); } catch { return false; }
  if (!uri.startsWith(base)) return false;
  const name = uri.slice(base.length);
  return OWNED_NAME.test(name);
}

export async function adoptOutboxFile(fs: OutboxFs, sourceUri: string, clientId: string): Promise<string> {
  // Defense-in-depth: the client id becomes a filename — reject anything that could
  // build a path outside the owned directory before touching the filesystem.
  if (!OWNED_NAME.test(clientId) || clientId.includes('.')) throw new Error('bad_client_id');
  const dest = dir(fs) + clientId + safeExt(sourceUri);
  await fs.makeDirectoryAsync(dir(fs), { intermediates: true }).catch(() => {});
  try {
    await fs.copyAsync({ from: sourceUri, to: dest });
  } catch (e) {
    // A failed/interrupted copy may leave a partial file — remove only that dest.
    await fs.deleteAsync(dest, { idempotent: true }).catch(() => {});
    throw e;
  }
  return dest;
}

export async function deleteOwnedOutboxFile(fs: OutboxFs, uri: string | undefined | null): Promise<void> {
  if (!isOwnedOutboxUri(fs, uri)) return;
  await fs.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

// Wipe owned files one-by-one after listing; never recursive directory deletion.
export async function clearOutboxMedia(fs: OutboxFs): Promise<void> {
  if (!fs.documentDirectory || !fs.readDirectoryAsync) return;
  let names: string[];
  try { names = await fs.readDirectoryAsync(dir(fs)); } catch { return; }
  const base = dir(fs);
  for (const name of names) {
    if (!OWNED_NAME.test(name)) continue;
    await fs.deleteAsync(base + name, { idempotent: true }).catch(() => {});
  }
}
