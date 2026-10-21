import { MailCheck } from "lucide-react";
import { Link } from "react-router";
import { UNSUBSCRIBE_COPY } from "../../shared/notifications";
import { buttonClasses } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";

// Where unsubscribe links in emails sent before v4.7 land. Hub email is now required for everyone, so nothing is
// turned off here; the page explains and points to Email settings, where each email can move to the morning digest.

export function UnsubscribePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4">
      <p className="text-secondary font-medium text-ink-2">Church Projects Hub</p>
      <h1 className="flex items-center gap-3 text-title">
        <Icon icon={MailCheck} className="text-accent-ink" />
        {UNSUBSCRIBE_COPY.title}
      </h1>
      <p className="text-body text-ink-2">{UNSUBSCRIBE_COPY.body}</p>
      <div>
        <Link to="/settings/notifications" className={buttonClasses()}>
          Choose when emails arrive
        </Link>
      </div>
    </main>
  );
}
