import type { AwsTempCredentials } from "@athena-shell/shared";

const REFRESH_SKEW_MS = 5 * 60 * 1000;

export class CredentialsCache {
  private cached: AwsTempCredentials | null = null;
  private inflight: Promise<AwsTempCredentials> | null = null;

  constructor(private readonly fetcher: () => Promise<AwsTempCredentials>) {}

  async get(): Promise<AwsTempCredentials> {
    if (this.cached && !this.expiringSoon(this.cached)) return this.cached;
    if (this.inflight) return this.inflight;
    this.inflight = this.fetcher()
      .then((c) => {
        this.cached = c;
        this.inflight = null;
        return c;
      })
      .catch((err) => {
        this.inflight = null;
        throw err;
      });
    return this.inflight;
  }

  invalidate(): void {
    this.cached = null;
  }

  private expiringSoon(c: AwsTempCredentials): boolean {
    const expMs = new Date(c.expiration).getTime();
    return expMs - Date.now() < REFRESH_SKEW_MS;
  }
}
