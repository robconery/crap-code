/**
 * FakeFileStorage — hand-written test double for the FileStorage port.
 *
 * Returns deterministic signed URLs so tests can assert on URL content
 * and TTL without touching Firebase. Optionally configured to throw.
 *
 * Why a fake over a mock: predictable, self-documenting, no fragile
 * argument matchers.
 */
import type { FileStorage } from "@/lib/infra/storage/file-storage.port";

export class FakeFileStorage implements FileStorage {
  /** All getSignedUrl calls recorded as {path, ttlSeconds} tuples. */
  readonly calls: Array<{ path: string; ttlSeconds: number }> = [];

  /** If set, the next getSignedUrl() call will throw this error. */
  #nextError: Error | undefined;

  /**
   * Configures the fake to throw on the next getSignedUrl() call.
   * Resets automatically after throwing.
   */
  failNextWith(error: Error): void {
    this.#nextError = error;
  }

  async getSignedUrl(path: string, ttlSeconds: number): Promise<string> {
    if (this.#nextError) {
      const err = this.#nextError;
      this.#nextError = undefined;
      throw err;
    }
    this.calls.push({ path, ttlSeconds });
    // Deterministic URL format so tests can assert on the content
    return `https://fake-storage.example.com/${path}?ttl=${ttlSeconds}`;
  }
}
