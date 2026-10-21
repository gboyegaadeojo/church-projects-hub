
// Sending email (section 5: Resend behind an EmailSender interface, so the provider can change by config alone —
// section 8 "Cap protection"). The cron job calls send(); a thrown error means "try again later".

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
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


