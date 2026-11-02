import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const sample = (n: string) => path.join(__dirname, "..", "samples", n);

/** Counts data rows in a lead CSV export (information block, blank line, header, rows). */
function csvDataRows(text: string): number {
  const lines = text.replace(/^\ufeff/, "").split(/\r\n/);
  const blank = lines.indexOf("");
  // Rows never contain raw newlines in these synthetic samples, so lines map 1:1 to records.
  return lines.slice(blank + 2).filter((l) => l.length > 0).length;
}

test("multi-file testing: compare, lead table filters, click-through, filtered export, replace, history", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await page.getByLabel("Reporting date").fill("2026-10-30");
  // Test C: three files with different columns, missing values and overlapping contacts.
  await page.getByTestId("file-input").setInputFiles([sample("01_study-abroad-dubai_leads.xlsx"), sample("02_australia-nz_leads.xlsx"), sample("07_partner-referrals_leads.csv")]);
  await expect(page.getByTestId("file-row")).toHaveCount(3);
  await expect(page.getByText("Ready", { exact: true })).toHaveCount(3);
  await expect(page.getByRole("list", { name: "Reporting workflow" })).toBeVisible();
  await expect(page.getByTestId("file-row").first()).toContainText("read & validated in");

  // Repeated upload of the same file is rejected clearly.
  await page.getByTestId("file-input").setInputFiles([sample("02_australia-nz_leads.xlsx")]);
  await expect(page.getByTestId("file-row")).toHaveCount(4);
  await expect(page.getByTestId("file-row").nth(3)).toContainText("already been uploaded");
  await page.getByTestId("file-row").nth(3).getByRole("button", { name: /Remove/ }).click();
  await page.getByRole("button", { name: "Remove file" }).click();
  await expect(page.getByTestId("file-row")).toHaveCount(3);

  // Compare before processing (testing mode).
  await page.getByRole("link", { name: /Compare Files/ }).click();
  await expect(page.getByRole("heading", { name: "Compare files" })).toBeVisible();
  await expect(page.getByText("Most valid leads")).toBeVisible();
  await expect(page.getByText("01_study-abroad-dubai_leads.xlsx (").first()).toBeVisible();
  await expect(page.getByText("Matching leads across files")).toBeVisible();
  await expect(page.getByText("Column differences")).toBeVisible();
  await page.getByRole("button", { name: "Preview reports" }).click();
  await expect(page.getByText("Preview only")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "All selected combined" })).toBeVisible();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download comparison (.xlsx)" }).click();
  expect((await dl).suggestedFilename()).toBe("Lead_File_Comparison_2026-10-30.xlsx");

  // Process all, then dashboard charts with click-through.
  await page.getByRole("link", { name: /Upload & Map/ }).click();
  await page.getByRole("button", { name: "Process all files" }).click();
  await expect(page.getByText("All files combined")).toBeVisible();
  await page.getByRole("link", { name: "Open dashboard" }).click();
  await expect(page.getByTestId("kpi-card").filter({ hasText: "Validation success" })).toBeVisible();
  await expect(page.getByText("Leads over time")).toBeVisible();
  await expect(page.getByText("Record quality by file")).toBeVisible();
  // Click a lead-status legend entry -> lead table filtered to that status.
  await page.getByRole("figure", { name: "Lead status distribution" }).getByRole("button").first().click();
  await expect(page.getByRole("heading", { name: "Lead table" })).toBeVisible();
  await expect(page.getByText(/^Lead status: /)).toBeVisible();

  // Lead table: clear filters, search, filter by status, export filtered CSV and compare counts.
  await page.getByRole("button", { name: /Remove filter Lead status/ }).click();
  await expect(page.getByTestId("lead-row").first()).toBeVisible();
  await page.getByRole("button", { name: "Filter by Status" }).click();
  await page.getByRole("dialog").getByText("Valid", { exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Status: Valid")).toBeVisible();
  const countText = await page.getByText(/ of [\d,]+ records/).innerText();
  const filteredTotal = Number(countText.split(" of ")[0].replace(/,/g, ""));
  expect(filteredTotal).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Export" }).click();
  const csvDl = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "CSV" }).first().click();
  const csv = await csvDl;
  expect(csv.suggestedFilename()).toBe("valid_leads_2026-10-30.csv");
  expect(csvDataRows(fs.readFileSync((await csv.path())!, "utf8"))).toBe(filteredTotal);

  // Detail view and file-by-file mode.
  await page.getByTestId("lead-row").first().click();
  await expect(page.getByRole("heading", { name: "Original values" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "File-by-file report" }).click();
  await expect(page.getByTestId("lead-row").first()).toBeVisible();

  // Report builder: invalid records only.
  await page.getByRole("link", { name: /Reports & Downloads/ }).click();
  await page.getByRole("combobox", { name: "Records to include" }).click();
  await page.getByRole("option", { name: "Invalid records only" }).click();
  const invDl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate & download" }).click();
  expect((await invDl).suggestedFilename()).toBe("invalid_records_2026-10-30.xlsx");
  await expect(page.getByText("invalid_records_2026-10-30.xlsx downloaded")).toBeVisible();

  // Replace a file with a new version.
  await page.getByRole("link", { name: /Upload & Map/ }).click();
  const partnerRow = page.getByTestId("file-row").filter({ hasText: "07_partner" });
  const chooser = page.waitForEvent("filechooser");
  await partnerRow.getByRole("button", { name: /Replace/ }).click();
  await (await chooser).setFiles(sample("03_ielts_leads.csv"));
  await expect(page.getByTestId("file-row").filter({ hasText: "03_ielts" })).toBeVisible();
  await expect(page.getByTestId("file-row").filter({ hasText: "07_partner" })).toHaveCount(0);

  // History shows the generated report with downloads.
  await page.getByRole("link", { name: /Report History/ }).click();
  await expect(page.getByTestId("history-row").first()).toBeVisible();
  await expect(page.getByTestId("history-row").first()).toContainText("current");
  const hDl = page.waitForEvent("download");
  await page.getByTestId("history-row").first().getByRole("button", { name: "Download summary PDF" }).click();
  expect((await hDl).suggestedFilename()).toMatch(/_summary\.pdf$/);

  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Clear session" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
});
