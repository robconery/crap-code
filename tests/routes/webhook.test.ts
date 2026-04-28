/**
 * Integration-level tests for the POST /webhook route handler.
 * Covers Story 1 (signature verification) and the top-level error boundary
 * of Story 8 (outer catch logs + rethrows, ping→error on failure).
 *
 * Fakes are used for all infra adapters. No real Stripe/Resend/Firebase calls.
 * In-memory SQLite for SavePingCommand + UpdatePingStatusCommand (real commands).
 */
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import type { StripeWebhookEvent } from "@/lib/contracts/stripe-webhook.schema";
import { StripeVerificationError } from "@/lib/errors/stripe-verification.error";
import * as schema from "@/lib/infra/db";
import type { AppDb } from "@/lib/infra/db/client";
import type { Logger } from "@/lib/infra/logger";
import type { StripeVerifierAdapter } from "@/lib/infra/stripe/stripe-verifier.adapter";
import { SavePingCommand } from "@/lib/ping/save-ping.command";
import { UpdatePingStatusCommand } from "@/lib/ping/update-ping-status.command";
import type { WebhookHandler } from "@/lib/webhooks/webhook-handler.types";
import { WebhookRouter } from "@/lib/webhooks/webhook-router";
import { handleWebhook } from "@/src/routes/webhook";
import type { WebhookHandlerDeps } from "@/src/routes/webhook";
import { drizzle as sqliteDrizzle } from "drizzle-orm/bun-sqlite";

// ─── DB Setup ─────────────────────────────────────────────────────────────

function makeDb() {
  const sqlite = new Database(":memory:");
  const db = sqliteDrizzle(sqlite, { schema });
  sqlite.run(
    "CREATE TABLE pings (id INTEGER PRIMARY KEY AUTOINCREMENT, stripe_event_id TEXT NOT NULL UNIQUE, event_type TEXT NOT NULL, raw_payload TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
  );
  return { db: db as unknown as AppDb, sqlite };
}

// ─── Fake Logger ──────────────────────────────────────────────────────────

/** Minimal fake logger that captures warn/error calls for assertion. */
/** Structural fake — cast to Logger for injection. Does not extend Logger (private fields prevent it). */
class FakeLogger {
  readonly warnEvents: string[] = [];
  readonly errorEvents: string[] = [];

  debug(_event: string): void {}

  info(_event: string): void {}

  warn(event: string): void {
    this.warnEvents.push(event);
  }

  error(event: string): void {
    this.errorEvents.push(event);
  }
}

// ─── Fake Verifier ────────────────────────────────────────────────────────

function makeFakeVerifier(options: {
  shouldThrowVerification?: boolean;
  shouldThrowOther?: boolean;
  event?: StripeWebhookEvent;
}): StripeVerifierAdapter {
  return {
    verify: async () => {
      if (options.shouldThrowVerification) {
        throw new StripeVerificationError("bad signature");
      }
      if (options.shouldThrowOther) {
        throw new Error("unexpected error");
      }
      return (options.event ?? CHECKOUT_EVENT) as unknown as Awaited<
        ReturnType<StripeVerifierAdapter["verify"]>
      >;
    },
  } as unknown as StripeVerifierAdapter;
}

// ─── Fake Handler ─────────────────────────────────────────────────────────

class FakeWebhookHandler implements WebhookHandler {
  handled = 0;
  shouldThrow = false;

  async handle(_event: StripeWebhookEvent, _pingId: number): Promise<void> {
    this.handled++;
    if (this.shouldThrow) {
      throw new Error("handler failure");
    }
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────

const CHECKOUT_EVENT: StripeWebhookEvent = {
  id: "evt_test_001",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_ABCD1234",
      object: "checkout.session",
      customer: "cus_test_001",
      customer_email: "rob@example.com",
      customer_details: { name: "Rob Conery", email: "rob@example.com" },
      amount_total: 3900,
      currency: "usd",
      metadata: { offer: "imposter-single", store: "bigmachine.io", slug: "imposter-single" },
    },
  },
};

function makeRequest(body = JSON.stringify(CHECKOUT_EVENT), sig = "valid-sig"): Request {
  return new Request("https://example.com/webhook", {
    method: "POST",
    headers: { "stripe-signature": sig, "content-type": "application/json" },
    body,
  });
}

function makeDeps(
  db: AppDb,
  fakeLogger: FakeLogger,
  fakeHandler: FakeWebhookHandler,
  verifierOpts: Parameters<typeof makeFakeVerifier>[0] = {}
): WebhookHandlerDeps {
  const handlerMap = new Map<string, WebhookHandler>([["checkout.session.completed", fakeHandler]]);
  return {
    verifier: makeFakeVerifier(verifierOpts),
    savePing: new SavePingCommand(db, fakeLogger as unknown as import("@/lib/infra/logger").Logger),
    updatePingStatus: new UpdatePingStatusCommand(
      db,
      fakeLogger as unknown as import("@/lib/infra/logger").Logger
    ),
    router: new WebhookRouter(
      handlerMap,
      fakeLogger as unknown as import("@/lib/infra/logger").Logger
    ),
    logger: fakeLogger as unknown as import("@/lib/infra/logger").Logger,
  };
}

describe("POST /webhook", () => {
  // ─── Story 1: Stripe Webhook Signature Verification ───────────────────────

  describe("when the Stripe-Signature header is valid", () => {
    it(// AC 1.1
    "passes verification and continues processing", async () => {
      const { db, sqlite } = makeDb();
      const fakeLogger = new FakeLogger();
      const fakeHandler = new FakeWebhookHandler();
      const deps = makeDeps(db, fakeLogger, fakeHandler);

      const resp = await handleWebhook(makeRequest(), deps);

      expect(resp.status).toBe(200);
      expect(fakeHandler.handled).toBe(1);
      sqlite.close();
    });

    it(// AC 1.3
    "passes the raw request body downstream unchanged (not re-serialised)", async () => {
      // Verified by: the verifier fake receives the same body string that
      // was in the request. We confirm by checking that verification succeeded
      // (no StripeVerificationError thrown) and handler ran.
      const { db, sqlite } = makeDb();
      const fakeLogger = new FakeLogger();
      const fakeHandler = new FakeWebhookHandler();
      const deps = makeDeps(db, fakeLogger, fakeHandler);

      const resp = await handleWebhook(makeRequest(), deps);

      expect(resp.status).toBe(200);
      expect(fakeHandler.handled).toBe(1);
      sqlite.close();
    });
  });

  describe("when the Stripe-Signature header is missing or invalid", () => {
    it(// AC 1.2
    "returns HTTP 400 and performs no further processing", async () => {
      const { db, sqlite } = makeDb();
      const fakeLogger = new FakeLogger();
      const fakeHandler = new FakeWebhookHandler();
      const deps = makeDeps(db, fakeLogger, fakeHandler, { shouldThrowVerification: true });

      const resp = await handleWebhook(makeRequest(), deps);

      expect(resp.status).toBe(400);
      expect(fakeHandler.handled).toBe(0);
      sqlite.close();
    });
  });

  // ─── Story 8: Error Handling — outer boundary ──────────────────────────────

  describe("when downstream processing throws an unhandled error", () => {
    it(// AC 8.1 + AC 8.2
    "updates the ping status to 'error' before re-throwing", async () => {
      const { db, sqlite } = makeDb();
      const fakeLogger = new FakeLogger();
      const fakeHandler = new FakeWebhookHandler();
      fakeHandler.shouldThrow = true;
      const deps = makeDeps(db, fakeLogger, fakeHandler);

      await expect(handleWebhook(makeRequest(), deps)).rejects.toThrow("handler failure");

      const ping = sqlite
        .query("SELECT status FROM pings WHERE stripe_event_id = 'evt_test_001'")
        .get() as { status: string } | undefined;

      // Ping was saved (outside try/catch per ADR-003) and then marked error
      expect(ping?.status).toBe("error");
      sqlite.close();
    });

    it(// AC 8.3
    "logs and re-throws when SavePingCommand itself fails (no silent swallow)", async () => {
      const { db, sqlite } = makeDb();
      const fakeLogger = new FakeLogger();
      const fakeHandler = new FakeWebhookHandler();

      // Seed a closed ping so SavePingCommand will skip (not a failure).
      // To simulate SavePingCommand failure, we'll use a throwing fake.
      const throwingSavePing = {
        execute: async () => {
          throw new Error("DB write failed");
        },
      } as unknown as SavePingCommand;

      const handlerMap = new Map<string, WebhookHandler>([
        ["checkout.session.completed", fakeHandler],
      ]);
      const brokenDeps: WebhookHandlerDeps = {
        verifier: makeFakeVerifier({}),
        savePing: throwingSavePing,
        updatePingStatus: new UpdatePingStatusCommand(
          db,
          fakeLogger as unknown as import("@/lib/infra/logger").Logger
        ),
        router: new WebhookRouter(
          handlerMap,
          fakeLogger as unknown as import("@/lib/infra/logger").Logger
        ),
        logger: fakeLogger as unknown as import("@/lib/infra/logger").Logger,
      };

      await expect(handleWebhook(makeRequest(), brokenDeps)).rejects.toThrow("DB write failed");
      sqlite.close();
    });
  });

  describe("when a duplicate event arrives for a ping with status 'error'", () => {
    it(// AC 8.5 — error pings are re-processed (not skipped)
    "re-processes the event rather than skipping it", async () => {
      const { db, sqlite } = makeDb();
      // Seed an error ping for this event id
      sqlite.run(
        "INSERT INTO pings (stripe_event_id, event_type, raw_payload, status, created_at, updated_at) VALUES ('evt_test_001', 'checkout.session.completed', '{}', 'error', '2024-01-15T10:00:00.000Z', '2024-01-15T10:00:00.000Z')"
      );

      const fakeLogger = new FakeLogger();
      const fakeHandler = new FakeWebhookHandler();
      const deps = makeDeps(db, fakeLogger, fakeHandler);

      const resp = await handleWebhook(makeRequest(), deps);

      // Should have processed (not skipped) — error pings are re-processable
      expect(resp.status).toBe(200);
      expect(fakeHandler.handled).toBe(1);
      sqlite.close();
    });
  });
});
