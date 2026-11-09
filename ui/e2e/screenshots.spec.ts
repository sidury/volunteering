// Captures docs/screenshots using made-up data on a throwaway volume. Only runs when SHOTS is set.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const OUT = process.env.SHOTS ?? "";
const W = { "X-VOL-Request": "1" };
test.skip(!OUT, "set SHOTS to capture screenshots");
test.use({ deviceScaleFactor: 2 });

function iso(offset: number): string {
  const d = new Date(Date.now() + offset * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function entry(r: APIRequestContext, days: number, organization: string, activity: string, hours: number, status: string, verifiedBy?: string) {
  const e = await (await r.post("/api/entries", { headers: W, data: { date: iso(-days), organization, activity, hours } })).json();
  if (status !== "draft") await r.post(`/api/entries/${e.id}/status`, { headers: W, data: { status, verifiedBy } });
}

async function shot(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

test("capture", async ({ page, request: r }) => {
  await r.put("/api/goal", { headers: W, data: { hours: 40, label: "Service hours this year", deadline: iso(180) } });
  await entry(r, 30, "Maple Food Pantry", "Sorted donations", 3, "verified", "Dana Lee");
  await entry(r, 21, "Riverside Animal Shelter", "Dog walking", 2.5, "verified", "Sam Ortiz");
  await entry(r, 14, "Town Library", "Book sale setup", 4, "verified", "Priya Shah");
  await entry(r, 7, "Maple Food Pantry", "Holiday drive", 3.5, "submitted");
  await entry(r, 2, "Green Trails Group", "Trail cleanup", 2, "draft");
  const opps = [
    ["Riverside Animal Shelter", "Weekend dog walker", "Animals", 4, "09:00", "11:30", "22 Mill Rd", 2.5, 14],
    ["Maple Food Pantry", "Food box packing", "Food and hunger", 9, "16:00", "18:00", "5 Maple Ave", 1.2, 13],
    ["Green Trails Group", "River cleanup day", "Environment", 13, "08:30", "12:00", "Riverside Park", 6, 12],
    ["Sunrise Senior Center", "Tech help hour", "Seniors", 18, "15:00", "16:30", "80 Oak St", 3.4, 15],
    ["Town Library", "Reading buddy", "Education", 24, "15:30", "17:00", "1 Main St", 0.8, 14],
  ] as const;
  for (const [organization, title, cause, days, start, end, location, distanceMiles, minAge] of opps) {
    const o = await (await r.post("/api/opportunities", { headers: W, data: { organization, title, cause, date: iso(days), start, end, location, distanceMiles, minAge } })).json();
    if (days === 4) await r.post(`/api/opportunities/${o.id}/going`, { headers: W, data: { going: true } });
  }
  await page.goto("/");
  await expect(page.locator(".stat").first()).toBeVisible();
  await shot(page, "dashboard");
  await page.goto("/hours");
  await expect(page.locator(".entry").first()).toBeVisible();
  await shot(page, "hours-log");
  await page.goto("/opportunities");
  await expect(page.locator(".opp").first()).toBeVisible();
  await shot(page, "opportunities");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".stat").first()).toBeVisible();
  await shot(page, "mobile");
});
