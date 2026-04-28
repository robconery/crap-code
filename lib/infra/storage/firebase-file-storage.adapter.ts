import { FulfillmentError } from "@/lib/errors/fulfillment.error";
import type { Logger } from "@/lib/infra/logger";
/**
 * FirebaseFileStorageAdapter — implements the FileStorage port using Firebase Admin SDK.
 *
 * This is the only file in the codebase that imports from firebase-admin.
 * The service account JSON is parsed once at construction time so we fail
 * fast if the config is malformed (fail-fast principle per SPEC).
 */
import { type App, cert, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import type { FileStorage } from "./file-storage.port";

export class FirebaseFileStorageAdapter implements FileStorage {
  readonly #app: App;
  readonly #logger: Logger;

  /**
   * @param serviceAccountJson - Stringified Firebase service account JSON.
   * @param bucketName - GCS bucket name (e.g. "bigmachine-files.appspot.com").
   * @param logger - For logging signed URL generation timing.
   */
  constructor(serviceAccountJson: string, bucketName: string, logger: Logger) {
    this.#logger = logger;
    try {
      // Parse and validate the service account at construction time — if the
      // JSON is malformed we want to fail at boot, not on the first request.
      const serviceAccount = JSON.parse(serviceAccountJson) as object;
      this.#app = initializeApp({ credential: cert(serviceAccount), storageBucket: bucketName });
    } catch (err: unknown) {
      throw new FulfillmentError("Failed to initialise Firebase — invalid service account JSON", {
        cause: err,
      });
    }
  }

  /**
   * Generates a signed URL for the given file path.
   * URLs expire after ttlSeconds — 7200 (2 hours) for fulfillment emails.
   */
  async getSignedUrl(path: string, ttlSeconds: number): Promise<string> {
    const start = Date.now();
    try {
      const bucket = getStorage(this.#app).bucket();
      const file = bucket.file(path);
      const expiry = Date.now() + ttlSeconds * 1000;
      const [url] = await file.getSignedUrl({ action: "read", expires: expiry });
      this.#logger.info("firebase.signedUrl.ok", { path, ttlSeconds, ms: Date.now() - start });
      return url;
    } catch (err: unknown) {
      this.#logger.error("firebase.signedUrl.failed", {
        path,
        ms: Date.now() - start,
        reason: err instanceof Error ? err.message : String(err),
      });
      throw new FulfillmentError(`Failed to generate signed URL for ${path}`, { cause: err });
    }
  }
}
