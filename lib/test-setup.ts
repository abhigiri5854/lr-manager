// Runs before every test file (vitest.config.mts setupFiles). lib/data reads the session from
// request cookies; here they live in a Map and the sample Owner is signed in by default.
import { beforeEach, vi } from "vitest";

// Unit tests run on the in-memory sample data, never the database.
process.env.DATA_SOURCE = "mock";

const jar = vi.hoisted(() => new Map<string, string>());

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

/** Signs in as this user for the rest of the test (null = logged out). */
export async function setTestUser(userId: string | null): Promise<void> {
  const { SESSION_COOKIE, sessionCookieValue } = await import("@/lib/data/session");
  jar.clear();
  if (userId) jar.set(SESSION_COOKIE, sessionCookieValue(userId));
}

export async function sampleOwnerId(): Promise<string> {
  return (await import("@/lib/data/_store")).SAMPLE_IDS.ownerId;
}

beforeEach(async () => {
  await setTestUser(await sampleOwnerId());
});
