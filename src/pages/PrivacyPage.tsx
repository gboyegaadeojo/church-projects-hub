import type { ReactNode } from "react";
import { Link } from "react-router";
import { AUTH_COPY } from "../../shared/auth";
import { BrandMark } from "../components/shell/BrandMark";

// Privacy policy (AUTH-10, section 11.15). Public and static: it loads without signing in and is linked
// from the Google consent screen (section 18). Covers every item 11.15 lists; NFR-5, NFR-24, ADM-6, ADM-8.

export const PRIVACY_UPDATED = "October 2026";

const linkClass = "text-accent-ink underline underline-offset-4";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-body font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function PrivacyPage() {
  const contact = (
    <a className={linkClass} href={`mailto:${AUTH_COPY.contactEmail}`}>
      {AUTH_COPY.contactEmail}
    </a>
  );
  return (
    <div className="min-h-dvh bg-page">
      <header className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 pt-8">
        <Link to="/" className="rounded-control">
          <BrandMark />
        </Link>
      </header>
      <main className="mx-auto flex max-w-2xl flex-col gap-group px-4 py-10 text-body text-ink">
        <div className="flex flex-col gap-2">
          <h1 className="text-large-title">Privacy policy</h1>
          <p className="text-secondary text-ink-2">Last updated {PRIVACY_UPDATED}</p>
        </div>

        <p>
          Church Projects Hub is a private work tracker for Immanuel Fellowship Church (IFC) volunteer teams. This page
          explains what it keeps about you, who can see it, and how to have it removed.
        </p>

        <Section title="What we get from Google">
          <p>
            You sign in with Google. We receive only your <strong>name</strong>, <strong>email address</strong> and{" "}
            <strong>profile photo</strong>, and Google's ID for your account. We use them to recognise you when you sign in,
            show who is working on what, and send you email about your work. We never see or store your Google password,
            and we don't ask for access to your Gmail, Drive, contacts or calendar.
          </p>
        </Section>

        <Section title="What the hub stores">
          <ul className="flex list-disc flex-col gap-2 pl-6">
            <li>Your name, email address, profile photo link, timezone and display settings (such as light or dark theme).</li>
            <li>Your access requests, the projects you belong to and your role in each.</li>
            <li>The work you add: tasks, comments, files and their history.</li>
            <li>
              For security: your sign-in sessions, with a one-way scrambled form of your IP address and the name of your
              browser, and a log of important actions (such as approvals and deletions) kept for one year.
            </li>
          </ul>
          <p>
            The hub runs on Cloudflare. Emails about your work are sent through Resend, which receives only what each email
            needs. We don't sell your data or show ads.
          </p>
          <p>
            We use a sign-in cookie, and your browser stores your theme choice and recently viewed pages so the app works offline. We
            don't use tracking or advertising cookies.
          </p>
        </Section>

        <Section title="Who can see it">
          <p>
            Nothing is public. People see only the projects an admin has approved them for. Members of a project see its
            tasks, comments and files, and the names and photos of people working on them. App administrators (IFC staff
            and volunteers who run the hub) can see all projects, the list of people and the security log, so they can
            approve access and keep the hub safe.
          </p>
        </Section>

        <Section title="Keep children's and pastoral details out">
          <p>
            Don't include children's details or confidential pastoral information. That means no children's names with
            ages, medical or allergy details, custody or contact information, and nothing shared in pastoral confidence, in
            tasks, comments or files. The hub is for planning work, not for records about people.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            Your details stay while you use the hub. When a project is archived, or a person's access is suspended, their
            details become eligible for full deletion after <strong>6 months</strong>. An app administrator reviews and
            confirms each deletion; nothing is deleted automatically.
          </p>
        </Section>

        <Section title="Asking us to delete your data">
          <p>
            Signed in, open <strong>Your data</strong> from your account menu and choose Request deletion, or email {contact}
            from the Google account you use here. We aim to finish
            within 30 days. Your name, email, photo and Google ID are removed and replaced with "Deleted User" plus a
            number. Tasks you worked on stay for the team, under that placeholder. A record that the deletion happened is
            kept in the security log.
          </p>
        </Section>

        <Section title="Contact">
          <p>Questions about this policy or your data: {contact}.</p>
        </Section>

        <Link to="/" className={linkClass}>
          Back to home
        </Link>
      </main>
    </div>
  );
}
