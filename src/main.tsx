import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { AppProviders } from "./components/ui/AppProviders";
import "./index.css";
import { HomePage } from "./pages/HomePage";
import { PrivacyPage } from "./pages/PrivacyPage";

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
