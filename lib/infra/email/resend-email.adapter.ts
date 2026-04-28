import { EmailSendError } from "@/lib/errors/email-send.error";
import type { Logger } from "@/lib/infra/logger";
/**
 * ResendEmailAdapter — implements the EmailSender port using the Resend SDK.
 *
 * This is the only file in the codebase that imports from the Resend SDK.
 * All domain code calls EmailSender (the port) — never this class directly.
 */
import { Resend } from "resend";
import type { EmailSender, SendEmailOptions } from "./email-sender.port";

export class ResendEmailAdapter implements EmailSender {
  readonly #resend: Resend;
  readonly #logger: Logger;

  constructor(apiKey: string, logger: Logger) {
    this.#resend = new Resend(apiKey);
    this.#logger = logger;
  }

  /**
   * Sends a transactional email via Resend.
   * Logs the send duration and throws EmailSendError on any failure.
   */
  async send(opts: SendEmailOptions): Promise<void> {
    const start = Date.now();
    const { error } = await this.#resend.emails.send({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });

    const ms = Date.now() - start;

    if (error) {
      this.#logger.error("resend.send.failed", { to: opts.to, ms, reason: error.message });
      throw new EmailSendError(`Failed to send email to ${opts.to}: ${error.message}`);
    }

    this.#logger.info("resend.send.ok", { to: opts.to, ms });
  }
}
