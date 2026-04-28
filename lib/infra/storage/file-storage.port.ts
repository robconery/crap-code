/**
 * FileStorage port — the interface describing the file storage capability.
 *
 * Services in lib/ call this to generate signed download URLs.
 * The concrete Firebase implementation lives in lib/infra/storage/.
 * Tests use FakeFileStorage from /tests/fakes/.
 */

export interface FileStorage {
  /**
   * Generates a signed URL for the given storage path.
   * @param path - The storage object path (e.g. "imposter-single.zip")
   * @param ttlSeconds - URL expiry in seconds (2 hours = 7200 for fulfillment emails)
   */
  getSignedUrl(path: string, ttlSeconds: number): Promise<string>;
}
