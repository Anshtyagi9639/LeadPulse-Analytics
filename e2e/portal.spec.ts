import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const SAMPLES = path.join(__dirname, "..", "samples");
const sample = (n: string) => path.join(SAMPLES, n);

async function startSession(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Generate today's lead report" })).toBeVisible();
  await page.getByLabel("Reporting date").fill("2026-10-30");
}

test("complete multi-file workflow: upload, map, process, dashboard, duplicates, exports, clear", async ({ page }) => {
  await startSession(page);

  // 1. Upload several files at once.
  await page.getByTestId("file-input").setInputFiles([sample("01_study-abroad-dubai_leads.xlsx"), sample("02_australia-nz_leads.xlsx"), sample("03_ielts_leads.csv")]);
  await expect(page.getByTestId("file-row")).toHaveCount(3);
  await expect(page.getByText("Ready", { exact: true })).toHaveCount(3);
  await expect(page.getByText("Raw rows")).toBeVisible();

  // 2. Inspect the mapping of the Dubai file (title rows above the header were skipped).
  await page.getByTestId("file-row").filter({ hasText: "01_study-abroad-dubai" }).getByRole("button", { name: "Map columns" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Leads Export (")).toBeVisible();
  await expect(dialog.getByRole("cell", { name: "Lead Created Date" })).toBeVisible();
  await dialog.getByRole("tab", { name: /Data preview/ }).click();
  await expect(dialog.getByRole("columnheader", { name: "Campaign Name" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // 3. Process a single file first.
  await page.getByTestId("file-row").filter({ hasText: "01_study-abroad-dubai" }).getByRole("button", { name: "Process", exact: true }).click();
  await expect(page.getByText("2 uploaded file(s) are not included in this report.")).toBeVisible();

  // 4. Add more files later into the same session, then process everything.
  await page.getByTestId("file-input").setInputFiles([sample("04_bba-mba_leads.xls"), sample("05_cwitp_leads.xlsx"), sample("06_ad-spend.xlsx")]);
  await expect(page.getByTestId("file-row")).toHaveCount(6);
  await page.getByRole("button", { name: "Process all files" }).click();
  await expect(page.getByText("All files combined")).toBeVisible();
  await expect(page.getByText("6 · 6 in report")).toBeVisible();

  // 5. Dashboard.
  await page.getByRole("link", { name: "Open dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Daily dashboard" })).toBeVisible();
  const cards = page.getByTestId("kpi-card");
  await expect(cards).toHaveCount(13); // 8 headline KPIs + 5 record-quality KPIs
  await expect(cards.filter({ hasText: "Total ad spend" })).toContainText("88,500");
  await expect(cards.filter({ hasText: "CPL" }).first()).not.toContainText("N/A");
  await expect(page.getByText("Lead funnel")).toBeVisible();
  await page.getByRole("tab", { name: "Campaigns" }).click();
  await expect(page.getByRole("cell", { name: "SA Dubai Oct Lead Gen" })).toBeVisible();
  await page.getByRole("tab", { name: "Sales" }).click();
  await expect(page.getByRole("table", { name: "Counsellor performance" })).toBeVisible();

  // 6. Filter by campaign; the report recalculates.
  await page.getByRole("tab", { name: "Executive overview" }).click();
  await page.getByRole("button", { name: /^Campaigns/ }).click();
  await page.getByRole("dialog").getByText("SA Dubai Search", { exact: true }).click();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(cards.filter({ hasText: "Total ad spend" })).toContainText("14,200");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(cards.filter({ hasText: "Total ad spend" })).toContainText("88,500");

  // 7. Duplicates page: switch to manual review and decide one group.
  await page.getByRole("link", { name: /Duplicates/ }).first().click();
  await expect(page.getByRole("heading", { name: "Duplicate leads" })).toBeVisible();
  await page.getByRole("radio", { name: /Review duplicates manually/ }).click();
  const group = page.getByTestId("duplicate-group").first();
  await expect(group).toBeVisible();
  await group.getByRole("button", { name: "Keep latest" }).click();
  await expect(group.getByRole("button", { name: "Keep latest" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("radio", { name: /Exclude confirmed duplicates/ }).click();

  // 8. Data quality.
  await page.getByRole("link", { name: /Data Quality/ }).click();
  await expect(page.getByText("Duplicate rate")).toBeVisible();
  const dlErrors = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download validation errors (CSV)" }).click();
  expect((await dlErrors).suggestedFilename()).toMatch(/validation-errors\.csv$/);

  // 9. AI insights without a key: clear message, rest of the app unaffected.
  await page.getByRole("link", { name: /AI Insights/ }).click();
  await expect(page.getByText("AI insights are not configured")).toBeVisible();

  // 10. Exports.
  await page.getByRole("link", { name: /Reports & Downloads/ }).click();
  for (const [button, pattern] of [
    ["Download Excel (.xlsx)", /lead-report_2026-10-30_report\.xlsx$/],
    ["Download PDF", /lead-report_2026-10-30_report\.pdf$/],
    ["Campaign-wise performance", /campaigns\.csv$/],
  ] as const) {
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: button }).click();
    const d = await dl;
    expect(d.suggestedFilename()).toMatch(pattern);
    const p = await d.path();
    expect(fs.statSync(p!).size).toBeGreaterThan(500);
  }

  // 11. Remove a file -> recalculated.
  await page.getByRole("link", { name: /Upload & Map/ }).click();
  await page.getByTestId("file-row").filter({ hasText: "05_cwitp" }).getByRole("button", { name: /Remove/ }).click();
  await page.getByRole("button", { name: "Remove file" }).click();
  await expect(page.getByTestId("file-row")).toHaveCount(5);
  await expect(page.getByText("5 · 5 in report")).toBeVisible();

  // 12. Clear the session (with confirmation).
  await page.getByRole("button", { name: "Clear session" }).click();
  await expect(page.getByText("Clear session & delete temporary data?")).toBeVisible();
  await page.getByRole("button", { name: "Delete everything" }).click();
  await expect(page.getByRole("heading", { name: "Generate today's lead report" })).toBeVisible();
  await expect(page.getByTestId("file-row")).toHaveCount(0);
  // Only the opaque session id was ever in browser storage, and it is gone now.
  const stored = await page.evaluate(() => ({ s: { ...sessionStorage }, l: { ...localStorage } }));
  expect(JSON.stringify(stored)).not.toMatch(/@example\.com|9000\d{6}/);
  expect(stored.s["leadpulse.sessionId"]).toBeUndefined();
});

test("bad files are reported clearly and do not block good ones", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("file-input").setInputFiles([
    { name: "broken.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("PK\u0003\u0004 not a workbook") },
    { name: "03_ielts_leads.csv", mimeType: "text/csv", buffer: fs.readFileSync(sample("03_ielts_leads.csv")) },
  ]);
  await expect(page.getByTestId("file-row")).toHaveCount(2);
  await expect(page.getByTestId("file-row").filter({ hasText: "broken.xlsx" })).toContainText("Error");
  await expect(page.getByTestId("file-row").filter({ hasText: "03_ielts" })).toContainText("Ready");
  // Unsupported type is rejected in the browser before upload.
  await page.getByTestId("file-input").setInputFiles([{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") }]);
  await expect(page.getByText(/Unsupported file type: notes\.txt/)).toBeVisible();
  await page.getByRole("button", { name: "Clear session" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
});

test("session survives a page reload and pages render without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await startSession(page);
  await page.getByTestId("file-input").setInputFiles([sample("02_australia-nz_leads.xlsx")]);
  await expect(page.getByText("Ready", { exact: true })).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId("file-row")).toHaveCount(1);
  for (const p of ["/duplicates", "/quality", "/spend", "/dashboard", "/leads", "/compare", "/insights", "/exports", "/history", "/definitions"]) {
    await page.goto(p);
    await expect(page.locator("main h1, main h2").first()).toBeVisible();
  }
  await page.goto("/spend");
  await page.getByRole("button", { name: "Add row" }).click();
  await page.getByLabel("Campaign").fill("ANZ Masters Intake 2027");
  await page.getByLabel("spend", { exact: true }).fill("4500");
  await page.getByRole("button", { name: "Save & recalculate" }).click();
  await expect(page.getByText("Spend and targets saved")).toBeVisible();
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Clear session" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
});
