// Quotes list fetch/cache controller. The caller supplies live() — mounted AND the
// immutable token captured at mount still current — and every async path re-checks
// it, including queued cache writes, so a response from an old account can neither
// render nor repopulate the wiped store. A pull generation additionally ensures the
// newest refresh always wins.
export interface QuotesFeedOpts<QuoteT> {
  live(): boolean;
  fetch(signal?: AbortSignal): Promise<QuoteT[]>;
  loadCache(): Promise<QuoteT[] | null>;
  queueWrite(isCurrent: () => boolean, action: () => unknown): Promise<unknown>;
  writeCache(quotes: QuoteT[]): Promise<unknown>;
  onQuotes(quotes: QuoteT[]): void;
  onCached(quotes: QuoteT[]): void;
  onError(message: string): void;
}

export interface QuotesFeed {
  pull(): Promise<void>;
  restore(): Promise<void>;
  close(): void;
}

export function createQuotesFeed<QuoteT>(opts: QuotesFeedOpts<QuoteT>): QuotesFeed {
  let mounted = true;
  let gen = 0;
  let ac: AbortController | null = null;
  const ok = (g: number) => mounted && g === gen && opts.live();

  return {
    async pull() {
      const g = ++gen;
      ac?.abort();
      ac = new AbortController();
      try {
        const quotes = await opts.fetch(ac.signal);
        if (!ok(g)) return;
        opts.onQuotes(quotes);
        await opts.queueWrite(() => ok(g), () => opts.writeCache(quotes));
      } catch (e) {
        if (ok(g)) opts.onError(e instanceof Error ? e.message : String(e));
      }
    },
    async restore() {
      // No pull-generation check: a concurrent pull must not suppress the offline
      // cache restore — the caller merges (keeps fresher data) via onCached.
      const cached = await opts.loadCache().catch(() => null);
      if (mounted && opts.live() && cached) opts.onCached(cached);
    },
    close() {
      mounted = false;
      ++gen;
      ac?.abort();
      ac = null;
    },
  };
}
