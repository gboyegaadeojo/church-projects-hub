import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { AppProviders } from "./components/ui/AppProviders";
import "./index.css";
import { AppShell } from "./components/shell/AppShell";
import { AdminProjectsPage } from "./pages/AdminProjectsPage";
import { AdminRequestsPage } from "./pages/AdminRequestsPage";
import { ProjectPage } from "./pages/ProjectPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { HomePage } from "./pages/HomePage";
import { InvitePage } from "./pages/InvitePage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { RequestAccessPage } from "./pages/RequestAccessPage";
import { InviteExpiredPage, InviteMismatchPage, SuspendedPage } from "./pages/SecurityScreens";
import { WorkPage } from "./pages/WorkPage";

const queryClient = new QueryClient();

// Component gallery for development only; the import is dropped from production builds.
const DevComponentsPage = import.meta.env.DEV ? lazy(() => import("./pages/dev/DevComponentsPage")) : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppProviders>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/request-access" element={<RequestAccessPage />} />
            {/* Active members: inside the app shell (section 12). */}
            <Route element={<AppShell />}>
              <Route path="/work" element={<WorkPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:key" element={<ProjectPage />} />
              <Route path="/admin/requests" element={<AdminRequestsPage />} />
              <Route path="/admin/projects" element={<AdminProjectsPage />} />
            </Route>
            <Route path="/invite/:token" element={<InvitePage />} />
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
      </AppProviders>
    </QueryClientProvider>
  </StrictMode>,
);
