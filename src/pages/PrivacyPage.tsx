import { Link } from "react-router";

// Privacy policy (AUTH-10, section 11.15). Final wording is completed in Stage 2 before Google publishing.
export function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-12">
      <h1 className="text-[length:var(--text-title)] font-semibold">Privacy policy</h1>
      <p>Draft — to be completed in Stage 2. It must cover the items listed in section 11.15 of the requirements.</p>
      <Link to="/" className="text-accent underline-offset-4 hover:underline">
        Back to home
      </Link>
    </main>
  );
}
