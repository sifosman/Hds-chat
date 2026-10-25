// Session restore at app boot, kept platform-independent for testing. Boot must
// always finish (show login) for the current generation — including a fresh install
// with no token and storage failures — while identity reads are fenced to the exact
// token that was loaded so a token swap/logout mid-boot can't resurrect a stale user.
export interface BootAuth {
  readonly token: string | null;
  load(): Promise<string | null>;
}

export interface BootDeps<MeT> {
  auth: BootAuth;
  cachedUser(token: string): Promise<MeT | null>;
  fetchMe(): Promise<MeT>;
  cacheUser(token: string, user: MeT, isCurrent: () => boolean): Promise<unknown>;
}

export async function restoreSession<MeT>(
  deps: BootDeps<MeT>,
  alive: () => boolean,
  setUser: (u: MeT) => void,
  finishBoot: () => void,
): Promise<void> {
  const { auth } = deps;
  const validFor = (token: string) => alive() && auth.token === token;
  try {
    const token = await auth.load();
    if (!alive() || !token) return;
    const cached = await deps.cachedUser(token).catch(() => null);
    if (!validFor(token)) return;
    if (cached) {
      setUser(cached);
      finishBoot();
    }
    try {
      const user = await deps.fetchMe();
      if (!validFor(token)) return;
      setUser(user);
      await deps.cacheUser(token, user, () => validFor(token)).catch(() => {});
    } catch { /* Keep the session-bound cached identity usable while offline. */ }
  } catch { /* Storage failure or a rejected load still lands on the login screen. */ } finally {
    if (alive()) finishBoot();
  }
}
