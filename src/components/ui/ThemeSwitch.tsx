import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { useId } from "react";
import { cn } from "../../lib/cn";
import { useTheme, type ThemePreference } from "../../theme/theme";
import { Icon } from "./Icon";

// Light / Dark / System switch (section 9). A radio group styled as a segmented control.
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
    <div className={cn("flex flex-col gap-2", className)}>
      <span id={labelId} className="text-secondary font-medium text-ink">
        Theme
      </span>
      <RadioGroup.Root
        aria-labelledby={labelId}
        value={preference}
        onValueChange={(value) => setPreference(value as ThemePreference)}
        orientation="horizontal"
        className="inline-flex w-fit gap-1 rounded-control border border-line-strong bg-card p-1"
      >
        {options.map((option) => (
          <RadioGroup.Item
            key={option.value}
            value={option.value}
            className={cn(
              "inline-flex min-h-touch items-center gap-2 rounded-chip px-3 text-secondary text-ink-2",
              "transition-colors duration-(--duration-menu) ease-out state-hover:bg-hover state-hover:text-ink",
              "data-[state=checked]:bg-accent-soft data-[state=checked]:font-medium data-[state=checked]:text-accent-ink",
            )}
          >
            <Icon icon={option.icon} />
            {option.label}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  );
}
