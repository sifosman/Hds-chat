// External browser opening with the same trust contract as the rest of the shell:
// only sanitized HTTPS URLs may ever leave the app, and the opener takes no headers —
// a bearer token must never reach a third-party page.
import { externalHttps } from '../security.ts';

export type BrowserOpener = (url: string) => Promise<unknown>;

export function createExternalOpener(open: BrowserOpener) {
  return async (candidate: unknown): Promise<void> => {
    const url = externalHttps(candidate);
    if (!url) return;
    await open(url).catch(() => {});
  };
}
