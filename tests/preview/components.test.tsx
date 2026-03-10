// @vitest-environment jsdom

import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensurePreviewGenerated } from "./ensureGenerated";

afterEach(() => {
  cleanup();
});

let generatedOutDir = "";

beforeAll(async () => {
  generatedOutDir = await ensurePreviewGenerated();
});

function toRelativeSpecifier(filePath: string) {
  const relativePath = path.relative(__dirname, filePath).split(path.sep).join("/");
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

const generatedImports = {
  checkboxRoot: () =>
    import(/* @vite-ignore */ toRelativeSpecifier(path.join(generatedOutDir, "checkbox/Checkbox/CheckboxRoot.tsx"))),
  dialog: () => import(/* @vite-ignore */ toRelativeSpecifier(path.join(generatedOutDir, "dialog/index.ts"))),
  switch: () => import(/* @vite-ignore */ toRelativeSpecifier(path.join(generatedOutDir, "switch/index.ts"))),
};

describe("generated preview components", () => {
  it("updates checkbox controlled state", async () => {
    const user = userEvent.setup();
    const { CheckboxRoot } = await generatedImports.checkboxRoot();

    function Example() {
      const [checked, setChecked] = React.useState<boolean | "indeterminate">("indeterminate");

      return <CheckboxRoot checked={checked} onCheckedChange={setChecked} />;
    }

    render(<Example />);

    const button = screen.getByRole("button");
    expect(button.textContent).toContain("Indeterminate");

    await user.click(button);
    expect(button.textContent).toContain("Checked");
  });

  it("toggles switch state and restores focus after dialog close", async () => {
    const user = userEvent.setup();
    const [{ Switch }, { Dialog }] = await Promise.all([generatedImports.switch(), generatedImports.dialog()]);

    function DialogExample() {
      const [open, setOpen] = React.useState(false);

      return (
        <>
          <Switch.Root defaultChecked={false} />
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger asChild>
              <button type="button">Open dialog</button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Content>
                <Dialog.Overlay asChild>
                  <button aria-label="Dismiss overlay" tabIndex={-1} type="button" />
                </Dialog.Overlay>
                <div role="dialog">
                  <button type="button">Focusable action</button>
                  <Dialog.Close asChild>
                    <button type="button">Close dialog</button>
                  </Dialog.Close>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </>
      );
    }

    render(<DialogExample />);

    const switchButton = screen.getByRole("button", { name: /off/i });
    await user.click(switchButton);
    expect(screen.getByRole("button", { name: /on/i })).toBeTruthy();

    const trigger = screen.getByRole("button", { name: "Open dialog" });
    trigger.focus();
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(screen.getByRole("button", { name: "Focusable action" })).toBe(document.activeElement);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
