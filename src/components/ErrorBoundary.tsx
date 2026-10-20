import { RefreshCw, TriangleAlert } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

// Error boundaries (section 11.13): a crash in one section shows a contained error there, never a blank page,
// and the rest of the app keeps working. The crash is reported to the Worker, which logs it with a request id
// and counts it toward the error alert (NFR-15). Nothing internal is shown to the person.

export const ERROR_BOUNDARY_COPY = "Something went wrong loading this section. Try refreshing the page.";

function report(section: string, error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  try {
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section, message: message.slice(0, 300), path: window.location.pathname.slice(0, 200) }),
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => undefined);
  } catch {
    // Reporting must never cause a second error.
  }
}

type Props = { section: string; children: ReactNode; className?: string };

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, _info: ErrorInfo) {
    report(this.props.section, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className={
          this.props.className ??
          "m-4 flex flex-col items-center gap-4 rounded-card border border-danger-line bg-danger-soft px-4 py-10 text-center"
        }
      >
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-card text-danger-ink">
          <Icon icon={TriangleAlert} />
        </span>
        <p className="max-w-sm text-body text-ink">{ERROR_BOUNDARY_COPY}</p>
        <Button variant="secondary" icon={RefreshCw} onClick={() => window.location.reload()}>
          Refresh the page
        </Button>
      </div>
    );
  }
}
