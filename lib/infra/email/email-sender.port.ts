/**
 * EmailSender port — the interface describing the email capability the domain needs.
 *
 * Services in lib/ depend on this interface, never on the concrete Resend adapter.
 * This keeps the domain layer decoupled from the vendor and makes the fake trivial
 * to implement in tests (Adapter pattern — GoF).
 */

export interface SendEmailOptions {
  to: string;
  from: string;
  subject: string;
  html: string;
}

export interface EmailSender {
  /** Sends a transactional email. Throws EmailSendError on failure. */
  send(opts: SendEmailOptions): Promise<void>;
}
