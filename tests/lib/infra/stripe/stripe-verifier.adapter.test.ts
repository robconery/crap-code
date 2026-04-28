/**
 * Unit tests for StripeVerifierAdapter.
 * Covers Story 1 AC1–AC3.
 *
 * Stripe uses TextEncoder on the raw secret string (not base64-decode) per
 * SubtleCryptoProvider source. We replicate that here to generate valid HMAC
 * signatures for tests without relying on the synchronous Stripe helper.
 */
import { describe, expect, it } from "bun:test";
import { StripeVerificationError } from "@/lib/errors/stripe-verification.error";
import { Logger } from "@/lib/infra/logger";
import { StripeVerifierAdapter } from "@/lib/infra/stripe/stripe-verifier.adapter";

const TEST_SECRET = "whsec_test_secret_for_unit_tests_only";
const TEST_PAYLOAD = JSON.stringify({ id: "evt_test_001", type: "checkout.session.completed" });

/**
 * Builds a valid Stripe-Signature header using Web Crypto (HMAC-SHA256).
 * Replicates Stripe's SubtleCryptoProvider.computeHMACSignatureAsync:
 * key = TextEncoder(secret), payload = "{timestamp}.{body}"
 */
async function makeValidSignature(payload: string, secret: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const signatureHex = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `t=${timestamp},v1=${signatureHex}`;
}

function makeLogger(): Logger {
  return new Logger("test-correlation-id");
}

describe("StripeVerifierAdapter", () => {
  describe("when the Stripe-Signature header is valid", () => {
    it("returns the parsed Stripe event without throwing", async () => {
      const adapter = new StripeVerifierAdapter("sk_test_fake", TEST_SECRET, makeLogger());
      const sig = await makeValidSignature(TEST_PAYLOAD, TEST_SECRET);
      const result = await adapter.verify(TEST_PAYLOAD, sig);
      expect(result.id).toBe("evt_test_001");
      expect(result.type).toBe("checkout.session.completed");
    });

    it("returns the event constructed from the raw body string (not re-serialised)", async () => {
      const adapter = new StripeVerifierAdapter("sk_test_fake", TEST_SECRET, makeLogger());
      const sig = await makeValidSignature(TEST_PAYLOAD, TEST_SECRET);
      await expect(adapter.verify(TEST_PAYLOAD, sig)).resolves.toBeDefined();
    });
  });

  describe("when the Stripe-Signature header is missing", () => {
    it("throws a StripeVerificationError", async () => {
      const adapter = new StripeVerifierAdapter("sk_test_fake", TEST_SECRET, makeLogger());
      await expect(adapter.verify(TEST_PAYLOAD, "")).rejects.toBeInstanceOf(
        StripeVerificationError
      );
    });
  });

  describe("when the Stripe-Signature header is present but invalid", () => {
    it("throws a StripeVerificationError", async () => {
      const adapter = new StripeVerifierAdapter("sk_test_fake", TEST_SECRET, makeLogger());
      await expect(adapter.verify(TEST_PAYLOAD, "t=123,v1=badsignature")).rejects.toBeInstanceOf(
        StripeVerificationError
      );
    });
  });
});
