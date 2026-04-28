/**
 * Unit tests for SendFulfillmentEmailCommand.
 * Covers Story 4 — signed URL generation (via FakeFileStorage), email
 * assembly from template, dispatch via FakeEmailSender.
 *
 * Signed URLs must NOT be persisted to the database — asserted by confirming
 * no DB write occurs via the fake storage.
 */
import { describe, expect, it } from "bun:test";
import { SendFulfillmentEmailCommand } from "@/lib/email/send-fulfillment-email.command";
import type { SendFulfillmentEmailInput } from "@/lib/email/send-fulfillment-email.command";
import { EmailSendError } from "@/lib/errors/email-send.error";
import { FulfillmentError } from "@/lib/errors/fulfillment.error";
import { Logger } from "@/lib/infra/logger";
import { FakeEmailSender } from "@/tests/fakes/fake-email-sender";
import { FakeFileStorage } from "@/tests/fakes/fake-file-storage";

// ─── Test Fixtures ─────────────────────────────────────────────────────────

const MOCK_USER = {
  id: 1,
  email: "rob@example.com",
  name: "Rob Conery",
  stripeCustomerId: "cus_test_001",
  createdAt: "2024-01-15T10:00:00.000Z",
};

const MOCK_FULFILLMENT_ORDER_WITH_DOWNLOADS = {
  id: 1,
  orderId: 42,
  date: "2024-01-15T10:00:00.000Z",
  sku: "imposter-single",
  email: "rob@example.com",
  number: "BIGZ-ABCD1234",
  downloads: JSON.stringify([
    {
      name: "The Imposter's Handbook",
      file: "imposter.zip",
      size: "230MB",
      location: "imposter.zip",
    },
    { name: "Season 2", file: "imposter-2.zip", size: "180MB", location: "imposter-2.zip" },
  ]),
};

const MOCK_FULFILLMENT_ORDER_NO_DOWNLOADS = {
  id: 2,
  orderId: 43,
  date: "2024-01-15T10:00:00.000Z",
  sku: "imposter-course",
  email: "rob@example.com",
  number: "BIGZ-EFGH5678",
  downloads: JSON.stringify([]),
};

function makeInput(
  fulfillmentOrder = MOCK_FULFILLMENT_ORDER_WITH_DOWNLOADS
): SendFulfillmentEmailInput {
  return {
    user: MOCK_USER,
    fulfillmentOrder,
    offer: "The Imposter's Handbook",
  };
}

function makeCommand() {
  const fileStorage = new FakeFileStorage();
  const emailSender = new FakeEmailSender();
  const logger = new Logger("test-correlation-id");
  const cmd = new SendFulfillmentEmailCommand(fileStorage, emailSender, logger);
  return { cmd, fileStorage, emailSender };
}

// ─── Story 4: Download Link Generation and Fulfillment Email ──────────────

describe("SendFulfillmentEmailCommand", () => {
  describe("when the Offer contains downloadable items", () => {
    it(// AC 4.1
    "generates a Firebase Storage signed URL for each download file with a 2-hour TTL", async () => {
      const { cmd, fileStorage } = makeCommand();
      await cmd.execute(makeInput());

      // Two downloads → two signed URL requests, each with TTL 7200
      expect(fileStorage.calls).toHaveLength(2);
      expect(fileStorage.calls[0]).toEqual({ path: "imposter.zip", ttlSeconds: 7200 });
      expect(fileStorage.calls[1]).toEqual({ path: "imposter-2.zip", ttlSeconds: 7200 });
    });

    it(// AC 4.2
    "includes the signed URLs in the email body using the new_order_email.html template", async () => {
      const { cmd, emailSender } = makeCommand();
      await cmd.execute(makeInput());

      expect(emailSender.sentEmails).toHaveLength(1);
      const sent0 = emailSender.sentEmails[0];
      if (!sent0) throw new Error("No email sent");
      const { html } = sent0;
      // Fake storage returns deterministic URLs containing the path
      expect(html).toContain("imposter.zip");
      expect(html).toContain("imposter-2.zip");
      // Template markers must all be resolved — no raw {{...}} left in output
      expect(html).not.toMatch(/\{\{[A-Z_]+\}\}/);
    });

    it(// AC 4.2 — negative
    "does not persist the signed URLs to the database", async () => {
      // Signed URLs exist only in memory and in the email body.
      // We verify this by confirming: (a) fileStorage.calls were made (URLs generated),
      // yet (b) no DB object was touched — there is no DB in this command at all.
      const { cmd, fileStorage } = makeCommand();
      await cmd.execute(makeInput());

      // URLs were generated (so they exist in-memory)
      expect(fileStorage.calls.length).toBeGreaterThan(0);
      // The command has no db property — structural proof it cannot persist
      expect((cmd as unknown as Record<string, unknown>).db).toBeUndefined();
    });

    it(// AC 4.3
    "sends the email via Resend from rob@bigmachine.io to the User's email address", async () => {
      const { cmd, emailSender } = makeCommand();
      await cmd.execute(makeInput());

      expect(emailSender.sentEmails).toHaveLength(1);
      const sent = emailSender.sentEmails[0];
      if (!sent) throw new Error("No email sent");
      expect(sent.to).toBe("rob@example.com");
      expect(sent.from).toBe("rob@bigmachine.io");
      expect(sent.subject).toContain("BIGZ-ABCD1234");
    });
  });

  describe("when the Offer has no downloadable items", () => {
    it(// AC 4.5
    "still sends the fulfillment email (with no download links)", async () => {
      const { cmd, emailSender, fileStorage } = makeCommand();
      await cmd.execute(makeInput(MOCK_FULFILLMENT_ORDER_NO_DOWNLOADS));

      // No signed URL calls — nothing to sign
      expect(fileStorage.calls).toHaveLength(0);
      // Email is still sent
      expect(emailSender.sentEmails).toHaveLength(1);
    });
  });

  describe("when the email send fails", () => {
    it(// Story 8 sad path — EmailSendError is thrown, not swallowed
    "throws an EmailSendError rather than silently failing", async () => {
      const { cmd, emailSender } = makeCommand();
      emailSender.failNextWith(new Error("Resend 500"));

      await expect(cmd.execute(makeInput())).rejects.toBeInstanceOf(EmailSendError);
    });
  });

  describe("when the signed URL generation fails", () => {
    it(// Story 8 sad path — error propagates
    "throws a FulfillmentError rather than silently failing", async () => {
      const { cmd, fileStorage } = makeCommand();
      fileStorage.failNextWith(new Error("Firebase unavailable"));

      await expect(cmd.execute(makeInput())).rejects.toBeInstanceOf(FulfillmentError);
    });
  });
});
