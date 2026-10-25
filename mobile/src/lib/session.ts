// Token persistence with race-safe semantics. SecureStore operations are funneled
// through one FIFO queue so a slow set() can never resurrect a cleared session, and
// a load() that was in flight when a newer set()/clear() landed must not overwrite
// the fresher in-memory token.
export interface TokenStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  deleteItem(key: string): Promise<unknown>;
}

export function createAuth(store: TokenStore, key = 'hds.token') {
  let tokenCache: string | null = null;
  let revision = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(op: () => Promise<T>): Promise<T> => {
    const run = queue.catch(() => {}).then(op);
    queue = run.then(() => {}, () => {});
    return run;
  };
  return {
    get token() { return tokenCache; },
    set(t: string) {
      tokenCache = t;
      ++revision;
      void enqueue(() => store.setItem(key, t)).catch(() => {});
    },
    clear() {
      tokenCache = null;
      ++revision;
      void enqueue(() => store.deleteItem(key)).catch(() => {});
    },
    async load(): Promise<string | null> {
      const rev = revision;
      const stored = await enqueue(() => store.getItem(key).catch(() => null));
      if (rev === revision) tokenCache = stored;
      return tokenCache;
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;
