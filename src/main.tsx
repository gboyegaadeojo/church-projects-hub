import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { AppProviders } from "./components/ui/AppProviders";
import "./index.css";
import { AppShell } from "./components/shell/AppShell";
import { MaintenancePage } from "./components/StatusBanners";
import { useMaintenance } from "./lib/maintenance";
import { AdminProjectsPage } from "./pages/AdminProjectsPage";
import { AdminRequestsPage } from "./pages/AdminRequestsPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { ProjectMembersPage } from "./pages/ProjectMembersPage";
import { ProjectPage } from "./pages/ProjectPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { BugReportPage, FeatureRequestPage, MyFeedbackPage } from "./pages/FeedbackPages";
import { HomePage } from "./pages/HomePage";
import { InvitePage } from "./pages/InvitePage";
import { NotificationSettingsPage } from "./pages/NotificationSettingsPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { RequestAccessPage } from "./pages/RequestAccessPage";
import { SearchPage } from "./pages/SearchPage";
import { InviteExpiredPage, InviteMismatchPage, SuspendedPage } from "./pages/SecurityScreens";
import { UnsubscribePage } from "./pages/UnsubscribePage";
import { WhatsNewPage } from "./pages/WhatsNewPage";
import { WorkPage } from "./pages/WorkPage";

const queryClient = new QueryClient();

// Service worker (NFR-20): production only, so development always runs fresh code.
if (import.meta.env.PROD) void import("virtual:pwa-register").then(({ registerSW }) => registerSW({ immediate: true }));

/** NFR-18: the maintenance page replaces the app while the database is unreachable. */
function App() {
  const maintenance = useMaintenance();
  if (maintenance) return <MaintenancePage />;
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        {/* Pending people see it alone; active members inside the app shell. */}
        <Route path="/request-access" element={<RequestAccessPage />} />
        {/* Active members: inside the app shell (section 12). */}
        <Route element={<AppShell />}>
          <Route path="/work" element={<WorkPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/settings/notifications" element={<NotificationSettingsPage />} />
          <Route path="/whats-new" element={<WhatsNewPage />} />
          <Route path="/feedback" element={<MyFeedbackPage />} />
          <Route path="/feedback/bug" element={<BugReportPage />} />
          <Route path="/feedback/feature" element={<FeatureRequestPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:key" element={<ProjectPage />} />
          <Route path="/projects/:key/members" element={<ProjectMembersPage />} />
          <Route path="/admin/requests" element={<AdminRequestsPage />} />
          <Route path="/admin/projects" element={<AdminProjectsPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
        </Route>
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/unsubscribe" element={<UnsubscribePage />} />
        {/* Security-state screens (section 11.7) */}
        <Route path="/suspended" element={<SuspendedPage />} />
        <Route path="/invite-expired" element={<InviteExpiredPage />} />
        <Route path="/invite-mismatch" element={<InviteMismatchPage />} />
        {DevComponentsPage && (
          <Route
            path="/dev/components"
            element={
              <Suspense>
                <DevComponentsPage />
              </Suspense>
            }
          />
        )}
      </Routes>
    </BrowserRouter>
  );
}

// Component gallery for development only; the import is dropped from production builds.
const DevComponentsPage = import.meta.env.DEV ? lazy(() => import("./pages/dev/DevComponentsPage")) : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppProviders>
        <App />
      </AppProviders>
    </QueryClientProvider>
  </StrictMode>,
);
