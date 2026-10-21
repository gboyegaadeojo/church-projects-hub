import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { useId } from "react";
import { cn } from "../../lib/cn";
import { useTheme, type ThemePreference } from "../../theme/theme";
import { Icon } from "./Icon";

// Light / Dark / System switch (section 9): three small icon buttons — sun, moon, screen — in one row.
// A radio group, so each icon has its name ("Light", "Dark", "System") for screen readers and a hover hint.
const options: Array<{ value: ThemePreference; label: string; icon: LucideIcon }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

type ThemeSwitchProps = {
  className?: string;
  /** Signed in: saves the choice to the profile (it applies the theme itself). Defaults to this browser only. */
  onPreferenceChange?: (preference: ThemePreference) => void;
};

export function ThemeSwitch({ className, onPreferenceChange }: ThemeSwitchProps) {
  const theme = useTheme();
  const { preference } = theme;
  const setPreference = onPreferenceChange ?? theme.setPreference;
  const labelId = useId();
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <span id={labelId} className="text-secondary font-medium text-ink">
        Theme
      </span>
      <RadioGroup.Root
        aria-labelledby={labelId}
        value={preference}
        onValueChange={(value) => setPreference(value as ThemePreference)}
        orientation="horizontal"
        className="inline-flex gap-0.5 rounded-pill border border-line bg-page p-0.5"
      >
        {options.map((option) => (
          // A native hint on hover: a tooltip would open on focus as the account panel opens.
            <RadioGroup.Item
              key={option.value}
              value={option.value}
              aria-label={option.label}
              title={option.label}
              className={cn(
                "inline-flex size-touch items-center justify-center rounded-pill text-ink-2",
                "transition-colors duration-(--duration-menu) ease-out state-hover:bg-hover state-hover:text-ink",
                "data-[state=checked]:bg-card data-[state=checked]:text-accent-ink data-[state=checked]:shadow-raised",
              )}
            >
              <Icon icon={option.icon} size="sm" />
            </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  );
}
