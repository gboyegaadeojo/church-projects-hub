import { hmac } from "../lib/crypto";

// Sending email (section 5: Resend behind an EmailSender interface, so the provider can change by config alone —
// section 8 "Cap protection"). The cron job calls send(); a thrown error means "try again later".

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** RFC 8058 one-click unsubscribe (NOTIF-6). */
  unsubscribeUrl?: string | null;
};

export interface EmailSender {
  send(email: OutgoingEmail): Promise<void>;
}

/** Resend email API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(email: OutgoingEmail): Promise<void> {
    const headers: Record<string, string> = {};
    if (email.unsubscribeUrl) {
      headers["List-Unsubscribe"] = `<${email.unsubscribeUrl}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `Church Projects Hub <${this.from}>`,
        to: [email.to],
        reply_to: this.from,
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers,
      }),
    });
    if (!res.ok) {
      // Never include the address or the API key in the error that gets stored (NFR-5). A 429 retries like any failure.
      throw new Error(`Resend ${res.status}`);
    }
  }
}

/** The configured sender, or null when there's no Resend key yet (emails wait in the outbox until there is). */
export function emailSenderFor(env: Pick<Env, "RESEND_API_KEY" | "EMAIL_FROM">): EmailSender | null {
  const key = (env as { RESEND_API_KEY?: string }).RESEND_API_KEY;
  return key ? new ResendSender(key, env.EMAIL_FROM) : null;
}

/** Signed token for one-click unsubscribe from one event type (NOTIF-6). No login needed to use it. */
export function unsubscribeToken(secret: string, userId: number, eventType: string): Promise<string> {
  return hmac(secret, `unsubscribe:${userId}:${eventType}`);
}

/**
 * NOTIF-6: the footer link opens a page that confirms with one button (so mail scanners that follow links
 * unsubscribe nobody); the List-Unsubscribe header points at the API, which RFC 8058 mail apps POST to directly.
 */
export async function unsubscribeUrls(
  env: Pick<Env, "SESSION_SECRET" | "APP_BASE_URL">,
  userId: number,
  eventType: string,
): Promise<{ unsubscribe: string; oneClick: string }> {
  const t = await unsubscribeToken(env.SESSION_SECRET, userId, eventType);
  const query = `u=${userId}&e=${encodeURIComponent(eventType)}&t=${t}`;
  return { unsubscribe: `${env.APP_BASE_URL}/unsubscribe?${query}`, oneClick: `${env.APP_BASE_URL}/api/unsubscribe?${query}` };
}
