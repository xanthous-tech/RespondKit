import { expect, test } from "@playwright/test";

test("opens, restores the transcript, and sends a message", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect.poll(() => page.evaluate(() => "__REACT_GRAB__" in window)).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Transcribe Cantonese with confidence." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open support chat" }).click();

  const dialog = page.getByRole("dialog", { name: "Canto Support" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("My transcription stopped at 99%.")).toBeVisible();
  await expect(dialog.getByText("Thanks — I can help. Which browser are you using?")).toBeVisible();

  const message = "การถอดเสียงของฉันค้างอยู่ ช่วยดูให้หน่อยได้ไหม";
  await dialog.getByRole("textbox", { name: "Message" }).fill(message);
  await dialog.getByRole("button", { name: "Send message" }).click();
  await expect(dialog.getByText(message)).toBeVisible();
  const sentMessage = dialog.locator("article").filter({ hasText: message });
  await expect(sentMessage.getByText("Sent", { exact: true })).toBeVisible();

  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (testInfo.project.name === "mobile-chromium") {
    expect(box?.width).toBe(testInfo.project.use.viewport?.width);
    await expect(page.getByRole("button", { name: "Open support chat" })).toBeHidden();
  } else {
    expect(box?.width).toBeLessThan(420);
  }

  await page.screenshot({
    path: testInfo.outputPath(`widget-${testInfo.project.name}.png`),
    fullPage: true,
  });

  await dialog.getByRole("button", { name: "Close support chat" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Open support chat" })).toBeFocused();
});
