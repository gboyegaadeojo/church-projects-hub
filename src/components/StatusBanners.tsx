import { CloudOff, RefreshCw, Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { MeResponse } from "../../shared/auth";
import { MAINTENANCE_COPY } from "../lib/maintenance";
import { OFFLINE_COPY, useOnline } from "../lib/online";
import { BrandMark } from "./shell/BrandMark";
import { Button, IconButton } from "./ui/Button";
import { Icon } from "./ui/Icon";

// App-wide states: offline (section 11.10), maintenance (NFR-18) and the add-to-home-screen prompt (NFR-21).

/** Persistent amber banner while offline. Writes are disabled until reconnecting. */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="sticky top-0 z-40 flex items-start gap-2 border-b border-warning-line bg-warning-soft px-4 py-3 text-secondary text-ink">
      <Icon icon={CloudOff} className="mt-px text-warning-ink" />
      <span>{OFFLINE_COPY.banner}</span>
    </div>
  );
}

/** Shown instead of the app when the database is unreachable. No codes, no stack traces. */
export function MaintenancePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-start justify-center gap-6 px-4">
      <BrandMark />
      <h1 className="text-title text-ink">{MAINTENANCE_COPY}</h1>
      <Button variant="secondary" icon={RefreshCw} onClick={() => window.location.reload()}>
        Try again
      </Button>
    </main>
  );
}

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const PROMPTED_KEY = "cph-install-prompted";

function alreadyPrompted(): boolean {
  try {
    return localStorage.getItem(PROMPTED_KEY) === "1";
  } catch {
    return true;
  }
}

function rememberPrompted() {
  try {
    localStorage.setItem(PROMPTED_KEY, "1");
  } catch {
    // Not remembered; it may show once more.
  }
}

/** Once, after the second sign-in, and only if the app isn't already installed (NFR-21). */
export function InstallPrompt({ me }: { me: MeResponse }) {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [open, setOpen] = useState(false);
  const standalone = typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches;
  const iOS = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const eligible = me.signInCount >= 2 && !standalone && !alreadyPrompted();

  useEffect(() => {
    if (!eligible) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
      setOpen(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    // iPhone and iPad never fire beforeinstallprompt; they get instructions instead.
    if (iOS) setOpen(true);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, [eligible, iOS]);

  useEffect(() => {
    if (open) rememberPrompted();
  }, [open]);

  if (!open) return null;
  return (
    <div
      role="region"
      aria-label="Install the app"
      className="fixed inset-x-4 bottom-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom)+12px)] z-40 mx-auto flex max-w-md items-start gap-3 rounded-card border border-line bg-elevated p-4 shadow-floating md:bottom-4"
    >
      <Icon icon={Smartphone} className="mt-0.5 text-accent-ink" />
      <div className="flex flex-1 flex-col gap-2">
        <p className="text-secondary text-ink">
          {event ? "Add Church Projects Hub to your home screen for quicker access." : "Add Church Projects Hub to your home screen: tap Share, then Add to Home Screen."}
        </p>
        {event && (
          <div className="flex gap-2">
            <Button
              onClick={async () => {
                await event.prompt().catch(() => undefined);
                setOpen(false);
              }}
            >
              Add to home screen
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Not now
            </Button>
          </div>
        )}
      </div>
      <IconButton icon={X} label="Dismiss" onClick={() => setOpen(false)} />
    </div>
  );
}
