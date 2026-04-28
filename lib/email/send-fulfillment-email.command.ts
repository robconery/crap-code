/**
 * SendFulfillmentEmailCommand — assembles and dispatches the post-purchase email.
 *
 * Responsibilities:
 *  1. Generate a Firebase Storage signed URL (7200s TTL) per download.
 *  2. Build the HTML email from the new_order_email.html template using a tiny
 *     in-process renderer — no external template engine dep needed.
 *  3. Dispatch via the EmailSender port.
 *
 * Why no DB write: signed URLs are ephemeral tokens. Persisting them would
 * create stale data and a potential security leak. They live only in memory and
 * inside the outbound email body (per SPEC).
 *
 * Why the template is inlined: Cloudflare Workers have no `fs` module. Embedding
 * the template as a constant is the only safe approach without adding a bundler
 * plugin. The template source is kept in docs/reference/new_order_email.html as
 * the canonical design reference; changes there must be mirrored here.
 *
 * Injected ports (Adapter pattern — GoF): FileStorage, EmailSender, Logger.
 * Neither Resend nor Firebase is imported here — the ports keep this layer clean.
 */
import { EmailSendError } from "@/lib/errors/email-send.error";
import { FulfillmentError } from "@/lib/errors/fulfillment.error";
import type { FulfillmentOrder, User } from "@/lib/infra/db";
import type { EmailSender } from "@/lib/infra/email/email-sender.port";
import type { Logger } from "@/lib/infra/logger";
import type { FileStorage } from "@/lib/infra/storage/file-storage.port";

/** A single downloadable item parsed from the FulfillmentOrder.downloads JSON. */
export interface DownloadItem {
  name: string;
  file: string;
  size: string;
  location: string;
}

/** Shape passed to execute() — caller supplies User + FulfillmentOrder from DB. */
export interface SendFulfillmentEmailInput {
  user: User;
  fulfillmentOrder: FulfillmentOrder;
  /** Human-readable offer/product name — used in email subject and line items. */
  offer: string;
}

/** Signed URL TTL matching the SPEC requirement of 2 hours. */
const SIGNED_URL_TTL_SECONDS = 7200;

/** Sender address — fixed by business rule (SPEC). */
const FROM_ADDRESS = "rob@bigmachine.io";

export class SendFulfillmentEmailCommand {
  readonly #fileStorage: FileStorage;
  readonly #emailSender: EmailSender;
  readonly #logger: Logger;

  constructor(fileStorage: FileStorage, emailSender: EmailSender, logger: Logger) {
    this.#fileStorage = fileStorage;
    this.#emailSender = emailSender;
    this.#logger = logger;
  }

  /**
   * Generates signed URLs, builds the HTML from template, dispatches the email.
   * Does NOT write signed URLs to the database.
   *
   * @throws {FulfillmentError} if signed URL generation fails
   * @throws {EmailSendError}   if email dispatch fails
   */
  async execute(input: SendFulfillmentEmailInput): Promise<void> {
    const { user, fulfillmentOrder, offer } = input;

    this.#logger.info("email.fulfillment.start", {
      orderId: fulfillmentOrder.id,
      recipientEmail: user.email,
    });

    // Parse the downloads JSON stored in the FulfillmentOrder (ADR-002).
    // The DB guarantees this is a valid JSON array written by FulfillOrderCommand.
    let downloads: DownloadItem[];
    try {
      downloads = JSON.parse(fulfillmentOrder.downloads) as DownloadItem[];
    } catch (err: unknown) {
      throw new FulfillmentError("Failed to parse downloads from FulfillmentOrder", { cause: err });
    }

    // Generate a signed URL for each downloadable item. Per SPEC, TTL = 7200s.
    // Signed URLs are never persisted — they exist only in this scope and in the email.
    let signedUrls: Array<{ name: string; url: string }>;
    try {
      signedUrls = await Promise.all(
        downloads.map(async (dl) => ({
          name: dl.name,
          url: await this.#fileStorage.getSignedUrl(dl.location, SIGNED_URL_TTL_SECONDS),
        }))
      );
    } catch (err: unknown) {
      this.#logger.error("email.fulfillment.signed-url-failed", {
        orderId: fulfillmentOrder.id,
        reason: err instanceof Error ? err.message : String(err),
      });
      throw new FulfillmentError("Failed to generate signed download URLs", { cause: err });
    }

    const html = renderTemplate({
      orderNumber: fulfillmentOrder.number,
      orderDate: fulfillmentOrder.date,
      customerEmail: user.email,
      offerName: offer,
      signedUrls,
    });

    // Dispatch the email via the port — Resend adapter is wired in composition root.
    try {
      await this.#emailSender.send({
        to: user.email,
        from: FROM_ADDRESS,
        subject: `Your order from bigmachine.io — ${fulfillmentOrder.number}`,
        html,
      });
    } catch (err: unknown) {
      this.#logger.error("email.fulfillment.send-failed", {
        orderId: fulfillmentOrder.id,
        recipient: user.email,
        reason: err instanceof Error ? err.message : String(err),
      });
      throw new EmailSendError(
        `Failed to send fulfillment email for order ${fulfillmentOrder.number}`,
        { cause: err }
      );
    }

    this.#logger.info("email.fulfillment.sent", {
      orderId: fulfillmentOrder.id,
      recipientEmail: user.email,
      downloadCount: signedUrls.length,
    });
  }
}

// ─── Template Renderer ────────────────────────────────────────────────────────

interface TemplateContext {
  orderNumber: string;
  orderDate: string;
  customerEmail: string;
  offerName: string;
  signedUrls: Array<{ name: string; url: string }>;
}

/**
 * Minimal template renderer for the new_order_email.html template.
 *
 * Handles:
 *   {{PLACEHOLDER}}                    — simple variable substitution
 *   {{#each DOWNLOADS}} … {{/each}}    — repeating download button block
 *   {{#each LINE_ITEMS}} … {{/each}}   — repeating line item block
 *   {{YEAR}}                           — current year
 *
 * Why not Handlebars: saves ~50 KB of bundle weight for a template that only
 * needs two loops and a handful of substitutions. No new dep for a solved problem.
 */
function renderTemplate(ctx: TemplateContext): string {
  const year = new Date().getFullYear().toString();

  // Start from the canonical HTML template, inlined here because Cloudflare
  // Workers have no `fs` module. Source of truth: docs/reference/new_order_email.html
  let html = EMAIL_TEMPLATE;

  // Replace {{#each DOWNLOADS}} … {{/each}} with one rendered button per download.
  html = html.replace(
    /\{\{#each DOWNLOADS\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_match, block: string) => {
      if (ctx.signedUrls.length === 0) {
        // No downloads — omit the section entirely (AC 4.5)
        return "";
      }
      return ctx.signedUrls
        .map((dl) =>
          block
            .replace(/\{\{DOWNLOAD_URL\}\}/g, dl.url)
            .replace(/\{\{PRODUCT_NAME\}\}/g, escapeHtml(dl.name))
        )
        .join("");
    }
  );

  // Replace {{#each LINE_ITEMS}} … {{/each}} with a single line item for the offer.
  html = html.replace(
    /\{\{#each LINE_ITEMS\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_match, block: string) =>
      block
        .replace(/\{\{PRODUCT_NAME\}\}/g, escapeHtml(ctx.offerName))
        .replace(/\{\{PRODUCT_TYPE\}\}/g, "Digital download")
        .replace(/\{\{PRODUCT_PRICE\}\}/g, "")
  );

  // Simple scalar substitutions
  html = html
    .replace(/\{\{ORDER_NUMBER\}\}/g, escapeHtml(ctx.orderNumber))
    .replace(/\{\{ORDER_DATE\}\}/g, escapeHtml(ctx.orderDate))
    .replace(/\{\{CUSTOMER_EMAIL\}\}/g, escapeHtml(ctx.customerEmail))
    .replace(/\{\{YEAR\}\}/g, year);

  return html;
}

/**
 * Minimal HTML escaping to prevent XSS if user-supplied strings (e.g. customer
 * name, order number) appear in the output. Escapes the five XML/HTML specials.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Inlined Email Template ───────────────────────────────────────────────────
// Source: docs/reference/new_order_email.html
// Cloudflare Workers have no fs module — static assets must be bundled or inlined.
// Mirror any template design changes here.
const EMAIL_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Order from bigmachine.io</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f4f4f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 16px; color: #333333; }
    .wrapper { width: 100%; background-color: #f4f4f4; padding: 40px 0; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 4px; overflow: hidden; }
    .header { background-color: #1a1a1a; padding: 32px 40px; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.3px; }
    .header p { margin: 6px 0 0; font-size: 14px; color: #999999; }
    .body { padding: 40px; }
    .greeting { font-size: 16px; margin: 0 0 24px; line-height: 1.5; color: #333333; }
    .order-meta { background-color: #f9f9f9; border: 1px solid #e8e8e8; border-radius: 4px; padding: 16px 20px; margin-bottom: 32px; font-size: 14px; color: #555555; }
    .order-meta strong { color: #1a1a1a; }
    .section-label { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #999999; margin: 0 0 12px; }
    .line-items { border: 1px solid #e8e8e8; border-radius: 4px; overflow: hidden; margin-bottom: 32px; }
    .line-item { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #e8e8e8; }
    .line-item:last-child { border-bottom: none; }
    .line-item-name { font-size: 15px; font-weight: 600; color: #1a1a1a; }
    .line-item-type { font-size: 12px; color: #999999; margin-top: 2px; }
    .line-item-price { font-size: 15px; font-weight: 600; color: #1a1a1a; white-space: nowrap; }
    .downloads { margin-bottom: 32px; }
    .download-button { display: block; background-color: #1a1a1a; color: #ffffff; text-decoration: none; padding: 14px 24px; border-radius: 4px; font-size: 14px; font-weight: 600; text-align: center; margin-bottom: 10px; }
    .download-note { font-size: 13px; color: #999999; line-height: 1.5; }
    .divider { border: none; border-top: 1px solid #e8e8e8; margin: 32px 0; }
    .support { font-size: 14px; color: #555555; line-height: 1.6; }
    .support a { color: #1a1a1a; font-weight: 600; }
    .footer { background-color: #f9f9f9; border-top: 1px solid #e8e8e8; padding: 24px 40px; text-align: center; }
    .footer p { margin: 0; font-size: 12px; color: #aaaaaa; line-height: 1.6; }
    .footer a { color: #aaaaaa; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1>bigmachine.io</h1>
        <p>Order Confirmation</p>
      </div>
      <div class="body">
        <p class="greeting">Thanks for your purchase. Your download is ready and waiting for you below.</p>
        <div class="order-meta">
          <strong>Order:</strong> {{ORDER_NUMBER}}<br>
          <strong>Date:</strong> {{ORDER_DATE}}<br>
          <strong>Email:</strong> {{CUSTOMER_EMAIL}}
        </div>
        <p class="section-label">What you ordered</p>
        <div class="line-items">
          {{#each LINE_ITEMS}}
          <div class="line-item">
            <div>
              <div class="line-item-name">{{PRODUCT_NAME}}</div>
              <div class="line-item-type">{{PRODUCT_TYPE}}</div>
            </div>
            <div class="line-item-price">{{PRODUCT_PRICE}}</div>
          </div>
          {{/each}}
        </div>
        <div class="downloads">
          <p class="section-label">Your downloads</p>
          {{#each DOWNLOADS}}
          <a href="{{DOWNLOAD_URL}}" class="download-button">Download {{PRODUCT_NAME}}</a>
          {{/each}}
          <p class="download-note">These links are unique to your order. Save this email so you can retrieve your files in the future. If a link expires, reply to this email and we will sort it out.</p>
        </div>
        <hr class="divider">
        <div class="support">
          <p>Questions about your order? Reach out at <a href="mailto:rob@bigmachine.io">rob@bigmachine.io</a> and include your order number <strong>{{ORDER_NUMBER}}</strong>.</p>
        </div>
      </div>
      <div class="footer">
        <p>&copy; {{YEAR}} bigmachine.io &nbsp;|&nbsp; <a href="https://bigmachine.io">bigmachine.io</a><br>You received this because you placed an order at bigmachine.io.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
