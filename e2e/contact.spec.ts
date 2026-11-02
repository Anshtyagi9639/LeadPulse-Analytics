import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import fs from "node:fs";
import path from "node:path";

const sample = (n: string) => path.join(__dirname, "..", "samples", n);
const num = (t: string) => Number(t.replace(/[^\d]/g, ""));

test("Lead Contact Report: test session, mapping preview, filters, preview, generate, download, history, reset", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await page.getByLabel("Reporting date").fill("2026-10-30");
  await page.getByLabel(/Testing mode/).check();
  await page.getByTestId("file-input").setInputFiles([sample("08_salesmax_contact_export.xlsx"), sample("09_salesmax_team_b.csv"), sample("10_salesmax_partial.xlsx")]);
  await expect(page.getByTestId("file-row")).toHaveCount(3);
  await expect(page.getByTestId("test-badge")).toBeVisible();

  // Column preview & mapping for a file with different column names.
  await page.getByTestId("file-row").filter({ hasText: "09_salesmax" }).getByRole("button", { name: "Map columns" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: "Field for column Follow Up Date" })).toContainText("Next Follow-up Date");
  await expect(dialog.getByRole("combobox", { name: "Field for column Owner" })).toContainText("Assigned Counsellor");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Process all files" }).click();
  await expect(page.getByText("All files combined")).toBeVisible();

  // Contact report page
  await page.getByRole("link", { name: /Contact Report/ }).click();
  await expect(page.getByRole("heading", { name: "Lead Contact Report" })).toBeVisible();
  const kpis = page.getByTestId("contact-kpis").getByTestId("kpi-card");
  await expect(kpis).toHaveCount(12);
  const totalBefore = num(await kpis.filter({ has: page.getByText("Total leads", { exact: true }) }).locator(".text-2xl").innerText());
  expect(totalBefore).toBeGreaterThan(50);
  await expect(page.getByText("Not in the uploaded data")).toHaveCount(0); // every SalesMax column exists in at least one file
  // CALLS TODAY is reported as missing for file 09 in the files-and-columns table.
  await expect(page.getByRole("row").filter({ hasText: "09_salesmax_team_b.csv" }).getByRole("cell", { name: "CALLS TODAY", exact: true })).toBeVisible();

  // Click an owner row -> filtered KPIs, tables and graphs together.
  await page.getByRole("row").filter({ hasText: "Owner Alpha" }).first().click();
  await expect(page.getByText("Owner: Owner Alpha")).toBeVisible();
  const filtered = num(await kpis.filter({ has: page.getByText("Total leads", { exact: true }) }).locator(".text-2xl").innerText());
  expect(filtered).toBeLessThan(totalBefore);
  await expect(page.getByTestId("scope-strip")).toContainText(`Filtered leads ${filtered}`);

  // Hand-off to the lead table with the same filter: counts agree (valid + possible duplicates are in the report).
  await page.getByRole("button", { name: "Open these leads in the table" }).click();
  await expect(page.getByRole("heading", { name: "Lead table" })).toBeVisible();
  await expect(page.getByText("Owner: Owner Alpha").first()).toBeVisible();
  await page.getByRole("button", { name: "Filter by Status" }).click();
  await page.getByRole("dialog").getByText("Valid", { exact: true }).click();
  const possible = page.getByRole("dialog").getByText("Possible duplicate", { exact: true });
  if (await possible.count()) await possible.click();
  await page.getByRole("dialog").getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(new RegExp(`^${filtered} of [\\d,]+ records`))).toBeVisible();

  // Preview and generate the combined report (test session -> TEST_ prefix).
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Lead Contact Report" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("button", { name: "Preview report" }).click();
  await expect(page.getByRole("dialog").getByText("Expected leads")).toBeVisible();
  await expect(page.getByRole("dialog").getByText(String(totalBefore), { exact: true }).first()).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Generate this report" }).click();
  const row = page.getByTestId("generated-report").filter({ hasText: "TEST_Combined_Lead_Report_2026-10-30.xlsx" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Completed");
  const dl = page.waitForEvent("download");
  await row.getByRole("button", { name: /Download/ }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe("TEST_Combined_Lead_Report_2026-10-30.xlsx");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile((await file.path())!);
  expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary Report", "Full Data", "Duplicate Leads", "Invalid or Incomplete Leads", "File Comparison", "Processing Details"]);
  expect(wb.getWorksheet("Full Data")!.rowCount - 1).toBe(totalBefore);
  expect(String(wb.getWorksheet("Summary Report")!.getCell("A1").value)).toMatch(/^TEST REPORT/);
  const charts = Object.keys((await JSZip.loadAsync(fs.readFileSync((await file.path())!))).files).filter((p) => /^xl\/charts\/chart\d+\.xml$/.test(p));
  expect(charts.length).toBe(5);
  await expect(row).toContainText("1×");

  // Option A: individual reports + ZIP
  await page.getByText("A · Individual file reports").click();
  await page.getByRole("button", { name: "Generate report", exact: true }).click();
  await expect(page.getByTestId("generated-report").filter({ hasText: "TEST_Lead_Contact_Report_08_salesmax_contact_export_2026-10-30.xlsx" })).toBeVisible();
  const zdl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download individual reports (ZIP)" }).click();
  const zip = await zdl;
  expect(zip.suggestedFilename()).toBe("TEST_Individual_File_Reports_2026-10-30.zip");
  expect(Object.keys((await JSZip.loadAsync(fs.readFileSync((await zip.path())!))).files)).toHaveLength(3);

  // History: report IDs, timings and download again
  await page.getByRole("link", { name: /Report History/ }).click();
  const hist = page.getByTestId("history-report").filter({ hasText: "TEST_Combined_Lead_Report_2026-10-30.xlsx" });
  await expect(hist).toBeVisible();
  await expect(hist).toContainText(/\d+(\.\d)? (ms|s)/);
  const again = page.waitForEvent("download");
  await hist.getByRole("button", { name: /Download/ }).click();
  expect((await again).suggestedFilename()).toBe("TEST_Combined_Lead_Report_2026-10-30.xlsx");

  // Reset the test session
  await page.getByRole("button", { name: "Reset test" }).click();
  await page.getByRole("button", { name: "Reset test session" }).click();
  await expect(page.getByText("Test session reset")).toBeVisible();
  await expect(page.getByTestId("test-badge")).toBeVisible();
  await page.getByRole("link", { name: /Upload & Map/ }).click();
  await expect(page.getByTestId("file-row")).toHaveCount(0);

  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Clear session" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
});
