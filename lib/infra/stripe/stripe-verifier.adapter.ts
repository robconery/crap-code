/**
 * StripeVerifierAdapter — verifies incoming webhook signatures using the Stripe SDK.
 *
 * Uses constructEventAsync (not constructEvent) because Cloudflare Workers and
 * Bun both use the Web Crypto API which is async-only. The synchronous variant
 * throws "SubtleCryptoProvider cannot be used in a synchronous context".
 */
import { StripeVerificationError } from "@/lib/errors/stripe-verification.error";
import type { Logger } from "@/lib/infra/logger";
import Stripe from "stripe";

export class StripeVerifierAdapter {
  readonly #stripe: Stripe;
  readonly #webhookSecret: string;
  readonly #logger: Logger;

  /**
   * @param apiKey - Stripe secret API key (for SDK init).
   * @param webhookSecret - The signing secret from the Stripe Dashboard webhook endpoint.
   * @param logger - Structured logger for timing the verification call.
   */
  constructor(apiKey: string, webhookSecret: string, logger: Logger) {
    this.#stripe = new Stripe(apiKey, { apiVersion: "2025-02-24.acacia" });
    this.#webhookSecret = webhookSecret;
    this.#logger = logger;
  }

  /**
   * Verifies the webhook signature and returns the parsed Stripe event.
   * The raw body string is used exactly as received — never re-serialised —
   * so the HMAC check passes (AC 1.3).
   *
   * @throws {StripeVerificationError} if the signature is missing or invalid (AC 1.2).
   */
  async verify(rawBody: string, signatureHeader: string): Promise<Stripe.Event> {
    const start = Date.now();
    try {
      // constructEventAsync uses the Web Crypto API (async) — required in CF Workers and Bun.
      const event = await this.#stripe.webhooks.constructEventAsync(
        rawBody,
        signatureHeader,
        this.#webhookSecret
      );
      this.#logger.info("stripe.verify.ok", { eventType: event.type, ms: Date.now() - start });
      return event;
    } catch (err: unknown) {
      this.#logger.error("stripe.verify.failed", {
        ms: Date.now() - start,
        reason: err instanceof Error ? err.message : String(err),
      });
      throw new StripeVerificationError("Stripe webhook signature verification failed", {
        cause: err,
      });
    }
  }
}
