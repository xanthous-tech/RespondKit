import { expect, test } from "@playwright/test";

const accentColorNames = [
  "Red",
  "Orange",
  "Amber",
  "Yellow",
  "Lime",
  "Green",
  "Emerald",
  "Teal",
  "Cyan",
  "Sky",
  "Blue",
  "Indigo",
  "Violet",
  "Purple",
  "Fuchsia",
  "Pink",
  "Rose",
  "Slate",
  "Gray",
  "Zinc",
  "Neutral",
  "Stone",
];

test("opens, restores the transcript, and sends a message", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect
    .poll(() =>
      page.evaluate(() => {
        const reactGrab = (
          window as unknown as {
            __REACT_GRAB__?: {
              getToolbarState?: () => { defaultAction?: string } | null;
            };
          }
        ).__REACT_GRAB__;

        return reactGrab?.getToolbarState?.()?.defaultAction;
      }),
    )
    .toBe("comment");

  const configuration = page.getByRole("region", { name: "Widget configuration" });
  await expect(configuration).toBeVisible();

  const titleInput = configuration.getByRole("textbox", { name: "Widget title" });
  const accentSelect = configuration.getByRole("combobox", { name: "Accent color" });
  const openOnLoad = configuration.getByRole("checkbox", { name: /Open on load/ });

  await expect(accentSelect.locator("option")).toHaveCount(22);
  expect(await accentSelect.locator("option").allTextContents()).toEqual(accentColorNames);

  await titleInput.fill("Example Concierge");
  await accentSelect.selectOption("lime");

  const widgetRoot = page.locator(".respondkit-root[data-accent-color]").first();
  await expect(widgetRoot).toHaveAttribute("data-accent-color", "lime");
  await expect
    .poll(() =>
      widgetRoot.evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--respondkit-primary").trim(),
      ),
    )
    .toBe("oklch(53.2% 0.157 131.589)");

  const openLauncher = page.getByRole("button", { name: "Open support chat" });
  await openOnLoad.check();

  const dialog = page.getByRole("dialog", { name: "Example Concierge" });
  await expect(dialog).toBeVisible();
  const dialogHeading = dialog.getByRole("heading", { name: "Example Concierge" });
  const headerClose = dialog.getByRole("button", { name: "Close support chat" });
  const floatingClose = widgetRoot.locator(':scope > button[aria-label="Close support chat"]');
  await expect(dialogHeading).toBeFocused();

  if (testInfo.project.name === "desktop-chromium") {
    await expect(floatingClose).toBeVisible();
    await headerClose.hover();

    const tooltip = page.locator('[data-slot="tooltip-content"]');
    const tooltipPositioner = page.locator('[data-slot="tooltip-positioner"]');
    await expect(tooltip).toBeVisible();
    const tooltipColors = await tooltip.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        foreground: style.color,
      };
    });
    expect(tooltipColors.foreground).not.toBe(tooltipColors.background);

    const [widgetZIndex, tooltipZIndex] = await Promise.all([
      widgetRoot.evaluate((element) => Number(getComputedStyle(element).zIndex)),
      tooltipPositioner.evaluate((element) => Number(getComputedStyle(element).zIndex)),
    ]);
    expect(tooltipZIndex).toBeGreaterThan(widgetZIndex);

    await floatingClose.click();
    await expect(dialog).toBeHidden();
    await openLauncher.click();
    await expect(dialog).toBeVisible();
  } else {
    await expect(floatingClose).toBeHidden();
  }

  const customerBubble = dialog.getByText("My transcription stopped at 99%.", { exact: true });
  const operatorBubble = dialog.getByText("Thanks — I can help. Which browser are you using?", {
    exact: true,
  });
  await expect(customerBubble).toBeVisible();
  await expect(operatorBubble).toBeVisible();
  await expect
    .poll(() =>
      customerBubble.evaluate((element) => getComputedStyle(element).borderBottomRightRadius),
    )
    .toBe("4px");
  await expect
    .poll(() =>
      operatorBubble.evaluate((element) => getComputedStyle(element).borderBottomLeftRadius),
    )
    .toBe("4px");

  const messageInput = dialog.getByRole("textbox", { name: "Message" });
  const sendButton = dialog.getByRole("button", { name: "Send message" });
  const [messageInputBox, sendButtonBox] = await Promise.all([
    messageInput.boundingBox(),
    sendButton.boundingBox(),
  ]);
  expect(messageInputBox).not.toBeNull();
  expect(sendButtonBox).not.toBeNull();
  if (messageInputBox === null || sendButtonBox === null) {
    throw new Error("The message composer controls must have measurable bounds");
  }
  expect(messageInputBox.height).toBeCloseTo(sendButtonBox.height, 1);

  const message = "การถอดเสียงของฉันค้างอยู่ ช่วยดูให้หน่อยได้ไหม";
  await messageInput.fill(message);
  await sendButton.click();
  await expect(dialog.getByText(message)).toBeVisible();
  const sentMessage = dialog.locator("article").filter({ hasText: message });
  await expect(sentMessage.getByText("Sent", { exact: true })).toBeVisible();

  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (testInfo.project.name === "mobile-chromium") {
    expect(box?.width).toBe(testInfo.project.use.viewport?.width);
    await expect(floatingClose).toBeHidden();
  } else {
    expect(box?.width).toBeLessThan(420);
  }

  await page.screenshot({
    path: testInfo.outputPath(`widget-${testInfo.project.name}.png`),
    fullPage: true,
  });

  await headerClose.click();
  await expect(dialog).toBeHidden();
  await expect(openLauncher).toBeFocused();

  await openOnLoad.uncheck();
  await expect(dialog).toBeHidden();
});
