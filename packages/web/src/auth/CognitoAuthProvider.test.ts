import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CognitoAuthProvider } from "./CognitoAuthProvider";
import {
  clearSession,
  isNearExpiry,
  readSession,
  writeSession,
  type SessionTokens,
} from "./oidcSession";

const CONFIG = {
  region: "us-east-1",
  userPoolId: "us-east-1_test",
  clientId: "client-abc",
  identityPoolId: "us-east-1:pool",
  domain: "auth.example.com",
};

function tokens(overrides: Partial<SessionTokens> = {}): SessionTokens {
  return {
    idToken: "id.token.v1",
    accessToken: "access.token.v1",
    refreshToken: "refresh.v1",
    expiresAt: Date.now() + 60 * 60_000,
    ...overrides,
  };
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
    handler(String(url), init)
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  clearSession();
});

afterEach(() => {
  clearSession();
  vi.unstubAllGlobals();
});

describe("isNearExpiry", () => {
  it("is true once the expiry is within the leeway window", () => {
    const soon = tokens({ expiresAt: Date.now() + 60_000 });
    expect(isNearExpiry(soon, 300_000)).toBe(true);
  });
  it("is false when well outside the leeway window", () => {
    const fresh = tokens({ expiresAt: Date.now() + 30 * 60_000 });
    expect(isNearExpiry(fresh, 300_000)).toBe(false);
  });
});

describe("refreshIfNearExpiry — no-op cases", () => {
  it("does nothing when no session is stored", async () => {
    const fetchSpy = mockFetch(() => {
      throw new Error("should not fetch");
    });
    const provider = new CognitoAuthProvider(CONFIG);
    await provider.refreshIfNearExpiry();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does nothing when expiry is outside the leeway window", async () => {
    writeSession(tokens({ expiresAt: Date.now() + 60 * 60_000 }));
    const fetchSpy = mockFetch(() => {
      throw new Error("should not fetch");
    });
    const provider = new CognitoAuthProvider(CONFIG);
    await provider.refreshIfNearExpiry();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does nothing when session has no refresh_token", async () => {
    writeSession(tokens({ refreshToken: undefined, expiresAt: Date.now() + 60_000 }));
    const fetchSpy = mockFetch(() => {
      throw new Error("should not fetch");
    });
    const provider = new CognitoAuthProvider(CONFIG);
    await provider.refreshIfNearExpiry();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("refreshIfNearExpiry — happy path", () => {
  it("exchanges refresh_token and updates session", async () => {
    writeSession(tokens({ expiresAt: Date.now() + 60_000 }));
    const fetchSpy = mockFetch(async (url) => {
      if (!url.includes("/oauth2/token")) throw new Error(`unexpected fetch: ${url}`);
      return new Response(
        JSON.stringify({
          id_token: "id.token.v2",
          access_token: "access.token.v2",
          expires_in: 3600,
        }),
        { status: 200 }
      );
    });
    const provider = new CognitoAuthProvider(CONFIG);
    await provider.refreshIfNearExpiry();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const session = readSession()!;
    expect(session.idToken).toBe("id.token.v2");
    expect(session.accessToken).toBe("access.token.v2");
    expect(session.refreshToken).toBe("refresh.v1"); // kept
    expect(session.expiresAt).toBeGreaterThan(Date.now() + 30 * 60_000);
  });

  it("persists a rotated refresh_token when the server returns a new one", async () => {
    writeSession(tokens({ expiresAt: Date.now() + 60_000 }));
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          id_token: "id.v2",
          access_token: "access.v2",
          refresh_token: "refresh.v2",
          expires_in: 3600,
        }),
        { status: 200 }
      )
    );
    const provider = new CognitoAuthProvider(CONFIG);
    await provider.refreshIfNearExpiry();
    expect(readSession()!.refreshToken).toBe("refresh.v2");
  });
});

describe("refreshIfNearExpiry — concurrency + failure", () => {
  it("coalesces N concurrent callers onto a single network request", async () => {
    writeSession(tokens({ expiresAt: Date.now() + 60_000 }));
    let resolveResponse: (r: Response) => void = () => {};
    const fetchSpy = mockFetch(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        })
    );
    const provider = new CognitoAuthProvider(CONFIG);
    const promises = Array.from({ length: 10 }, () => provider.refreshIfNearExpiry());
    // all callers saw the same in-flight promise — only one fetch fired.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    resolveResponse(
      new Response(
        JSON.stringify({ id_token: "i", access_token: "a", expires_in: 3600 }),
        { status: 200 }
      )
    );
    await Promise.all(promises);
  });

  it("clears the session on 400 invalid_grant (refresh token expired)", async () => {
    writeSession(tokens({ expiresAt: Date.now() + 60_000 }));
    mockFetch(async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })
    );
    const provider = new CognitoAuthProvider(CONFIG);
    await provider.refreshIfNearExpiry();
    expect(readSession()).toBeNull();
  });
});
