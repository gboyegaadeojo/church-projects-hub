import { createContext, useContext, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";

// Overlays (dialogs, menus, tooltips, selects) portal into this container.
// By default that is document.body; a ThemeScope supplies its own so overlays opened
// inside it keep that scope's theme.
const PortalContainerContext = createContext<HTMLElement | null>(null);

export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext) ?? undefined;
}

type ThemeScopeProps = {
  theme: "light" | "dark";
  className?: string;
  children: ReactNode;
};

/** Renders a subtree, and any overlays it opens, in a fixed theme. */
export function ThemeScope({ theme, className, children }: ThemeScopeProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <div data-theme={theme} className={cn("bg-page text-ink", className)}>
      <PortalContainerContext.Provider value={container}>{children}</PortalContainerContext.Provider>
      <div ref={setContainer} />
    </div>
  );
}
