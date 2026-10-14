import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppProviders } from "./AppProviders";
import { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog";

type HarnessProps = Partial<Omit<ConfirmDialogProps, "open" | "onOpenChange">>;

// Renders a trigger button that opens the dialog, so focus return can be checked too.
function Harness(props: HarnessProps) {
  const [open, setOpen] = useState(false);
  return (
    <AppProviders>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete MEDIA-42?"
        description="This removes the task and its comments for everyone."
        confirmLabel="Delete task"
        onConfirm={() => {}}
        {...props}
      />
    </AppProviders>
  );
}

async function openDialog(props: HarnessProps = {}) {
  const user = userEvent.setup();
  render(<Harness {...props} />);
  await user.click(screen.getByRole("button", { name: "Open" }));
  const dialog = await screen.findByRole("alertdialog");
  return { user, dialog };
}

describe("Section 11.14 confirmation dialog", () => {
  it("names the action and consequence, and labels the destructive button with its verb", async () => {
    const { dialog } = await openDialog();
    expect(dialog).toHaveAccessibleName("Delete MEDIA-42?");
    expect(dialog).toHaveAccessibleDescription("This removes the task and its comments for everyone.");
    expect(screen.getByRole("button", { name: "Delete task" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(ok|yes)$/i })).not.toBeInTheDocument();
  });

  it("refuses vague button labels such as OK or Yes", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const label of ["OK", "Yes", "confirm"]) {
      expect(() =>
        render(
          <ConfirmDialog
            open
            onOpenChange={() => {}}
            title="Delete MEDIA-42?"
            description="This removes the task."
            confirmLabel={label}
            onConfirm={() => {}}
          />,
        ),
      ).toThrow(/Label the button with its verb/);
    }
    spy.mockRestore();
  });

  describe("focus order", () => {
    it("puts initial focus on Cancel", async () => {
      await openDialog();
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    });

    it("moves Cancel → destructive button and keeps focus trapped inside", async () => {
      const { user, dialog } = await openDialog();
      await user.tab();
      expect(screen.getByRole("button", { name: "Delete task" })).toHaveFocus();
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    });

    it("returns focus to the trigger after closing", async () => {
      const { user } = await openDialog();
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      await waitFor(() => expect(screen.getByRole("button", { name: "Open" })).toHaveFocus());
    });
  });

  describe("cancelling", () => {
    it("Escape cancels without running the action", async () => {
      const onConfirm = vi.fn();
      const { user } = await openDialog({ onConfirm });
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("clicking outside cancels without running the action", async () => {
      const onConfirm = vi.fn();
      const { user, dialog } = await openDialog({ onConfirm });
      // The dimmed overlay wraps the dialog panel; clicking it is a click outside.
      await user.click(dialog.parentElement!);
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("Cancel closes without running the action", async () => {
      const onConfirm = vi.fn();
      const { user } = await openDialog({ onConfirm });
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe("confirming", () => {
    it("runs the action, closes, and shows the result toast", async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      const { user } = await openDialog({ onConfirm, successMessage: "Task deleted." });
      await user.click(screen.getByRole("button", { name: "Delete task" }));
      expect(onConfirm).toHaveBeenCalledOnce();
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(await screen.findAllByText("Task deleted.")).not.toHaveLength(0);
    });

    it("stays open with an explanation if the action fails", async () => {
      const onConfirm = vi.fn().mockRejectedValue(new Error("network"));
      const { user, dialog } = await openDialog({ onConfirm });
      await user.click(screen.getByRole("button", { name: "Delete task" }));
      expect(await screen.findByText(/didn't go through/)).toBeInTheDocument();
      expect(dialog).toBeInTheDocument();
    });
  });

  describe("type-to-confirm (high-impact actions)", () => {
    const highImpact: HarnessProps = {
      title: "Archive the Media project?",
      description: "Members lose access to its board.",
      confirmLabel: "Archive project",
      confirmText: "MEDIA",
    };

    it("still focuses Cancel first and labels the field with what to type", async () => {
      await openDialog(highImpact);
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
      expect(screen.getByLabelText("Type MEDIA to confirm.")).toBeInTheDocument();
    });

    it("keeps the destructive button disabled until the text matches", async () => {
      const onConfirm = vi.fn();
      const { user } = await openDialog({ ...highImpact, onConfirm });
      const input = screen.getByLabelText("Type MEDIA to confirm.");
      const archive = screen.getByRole("button", { name: "Archive project" });

      expect(archive).toBeDisabled();
      for (const wrong of ["MED", "MEDIAX", "ME DIA"]) {
        await user.clear(input);
        await user.type(input, wrong);
        expect(archive).toBeDisabled();
        await user.keyboard("{Enter}");
        expect(onConfirm).not.toHaveBeenCalled();
      }

      await user.clear(input);
      await user.type(input, "MEDIA");
      expect(archive).toBeEnabled();
      await user.click(archive);
      expect(onConfirm).toHaveBeenCalledOnce();
    });

    it("ignores letter case and leading or trailing spaces", async () => {
      const onConfirm = vi.fn();
      const { user } = await openDialog({ ...highImpact, onConfirm });
      const input = screen.getByLabelText("Type MEDIA to confirm.");
      const archive = screen.getByRole("button", { name: "Archive project" });

      for (const typed of ["media", "Media", "  MEDIA  "]) {
        await user.clear(input);
        await user.type(input, typed);
        expect(archive).toBeEnabled();
      }
      await user.keyboard("{Enter}");
      expect(onConfirm).toHaveBeenCalledOnce();
    });

    it("matches an email address case-insensitively", async () => {
      const onConfirm = vi.fn();
      const { user } = await openDialog({
        title: "Suspend sam@example.org?",
        description: "They are signed out everywhere.",
        confirmLabel: "Suspend user",
        confirmText: "Sam@Example.org",
        onConfirm,
      });
      const input = screen.getByLabelText("Type Sam@Example.org to confirm.");
      const suspend = screen.getByRole("button", { name: "Suspend user" });

      await user.type(input, "sam@example.or");
      expect(suspend).toBeDisabled();
      await user.type(input, "g ");
      expect(suspend).toBeEnabled();
      await user.click(suspend);
      expect(onConfirm).toHaveBeenCalledOnce();
    });

    it("Escape still cancels while typing", async () => {
      const onConfirm = vi.fn();
      const { user } = await openDialog({ ...highImpact, onConfirm });
      await user.type(screen.getByLabelText("Type MEDIA to confirm."), "MED");
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("clears the typed text when reopened", async () => {
      const { user } = await openDialog(highImpact);
      await user.type(screen.getByLabelText("Type MEDIA to confirm."), "MEDIA");
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: "Open" }));
      expect(await screen.findByLabelText("Type MEDIA to confirm.")).toHaveValue("");
      expect(screen.getByRole("button", { name: "Archive project" })).toBeDisabled();
    });
  });
});
