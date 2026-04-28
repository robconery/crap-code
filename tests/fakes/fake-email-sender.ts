/**
 * FakeEmailSender — hand-written test double for the EmailSender port.
 *
 * Records every send() call so tests can assert on what was sent without
 * making real Resend API calls. Optionally configured to throw on the
 * next call to test error paths.
 *
 * Why a fake over a mock: fakes are stable, reusable contracts that don't
 * couple tests to internal call counts or argument matchers.
 */
import type { EmailSender, SendEmailOptions } from "@/lib/infra/email/email-sender.port";

export class FakeEmailSender implements EmailSender {
  /** All emails sent via this fake, in order. */
  readonly sentEmails: SendEmailOptions[] = [];

  /** If set, the next send() call will throw this error. */
  #nextError: Error | undefined;

  /**
   * Configures the fake to throw on the next send() call.
   * Resets automatically after throwing.
   */
  failNextWith(error: Error): void {
    this.#nextError = error;
  }

  async send(opts: SendEmailOptions): Promise<void> {
    if (this.#nextError) {
      const err = this.#nextError;
      this.#nextError = undefined;
      throw err;
    }
    this.sentEmails.push(opts);
  }
}
