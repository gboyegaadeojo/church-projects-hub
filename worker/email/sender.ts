import { hmac } from "../lib/crypto";

// Sending email (section 5: Brevo behind an EmailSender interface, so the provider can change by config alone —
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

/** Brevo transactional email API (v3). */
export class BrevoSender implements EmailSender {
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
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": this.apiKey, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "Church Projects Hub", email: this.from },
        replyTo: { email: this.from },
        to: [{ email: email.to }],
        subject: email.subject,
        htmlContent: email.html,
        textContent: email.text,
        headers,
      }),
    });
    if (!res.ok) {
      // Never include the address or the API key in the error that gets stored (NFR-5).
      throw new Error(`Brevo ${res.status}`);
    }
  }
}

/** The configured sender, or null when there's no Brevo key yet (emails wait in the outbox until there is). */
export function emailSenderFor(env: Pick<Env, "BREVO_API_KEY" | "EMAIL_FROM">): EmailSender | null {
  const key = (env as { BREVO_API_KEY?: string }).BREVO_API_KEY;
  return key ? new BrevoSender(key, env.EMAIL_FROM) : null;
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
