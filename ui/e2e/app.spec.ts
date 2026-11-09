// The student journey. Needs an empty data volume.
import { expect, test, type Page } from "@playwright/test";

const ROUTES = ["/", "/hours", "/opportunities"];
const XSS = `<img src=x onerror="window.__xss=1">`;

function iso(offset: number): string {
  const d = new Date(Date.now() + offset * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function logHours(page: Page, org: string, activity: string, hours: string) {
  await page.getByRole("button", { name: "Log hours" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Organization").fill(org);
  await d.getByLabel("Activity").fill(activity);
  await d.getByLabel("Hours").fill(hours);
  await d.getByRole("button", { name: "Log hours" }).click();
  await expect(d).toBeHidden();
}

async function addOpportunity(page: Page, org: string, title: string, days: number, miles: string, minAge: string) {
  await page.getByRole("button", { name: "Add opportunity" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Organization").fill(org);
  await d.getByLabel("Role").fill(title);
  await d.getByLabel("Cause").selectOption("Animals");
  await d.getByLabel("Date").fill(iso(days));
  await d.getByLabel("Starts").fill("09:00");
  await d.getByLabel("Ends").fill("11:30");
  await d.getByLabel("Distance, miles").fill(miles);
  await d.getByLabel("Minimum age").fill(minAge);
  await d.getByRole("button", { name: "Add opportunity" }).click();
  await expect(d).toBeHidden();
}

test.describe.serial("student journey", () => {
  test("first use shows a real welcome and no sample data", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Welcome to Volunteer Planner" })).toBeVisible();
    await page.goto("/hours");
    await expect(page.getByText("No hours logged yet")).toBeVisible();
    await page.goto("/opportunities");
    await expect(page.getByText("No opportunities yet")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("set a goal and log hours through to verified", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Set an hours goal" }).click();
    const goal = page.getByRole("dialog");
    await goal.getByLabel("Target hours").fill("10");
    await goal.getByLabel("Name (optional)").fill("This year");
    await goal.getByRole("button", { name: "Save goal" }).click();
    await expect(page.getByRole("heading", { name: "This year" })).toBeVisible();

    await logHours(page, "Food Pantry", "Sorting", "4");
    await logHours(page, "Library", XSS, "1");
    await expect(page.getByText("Still needs sign-off")).toBeVisible();
    await expect(page.locator(".stat", { hasText: "Hours so far" }).locator(".stat-value")).toHaveText("0 hours");
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

    await page.goto("/hours");
    await expect(page.getByText(XSS)).toBeVisible();
    const row = page.locator(".entry", { hasText: "Sorting" });
    await row.getByRole("button", { name: "Submit" }).click();
    await row.getByRole("button", { name: "Mark verified" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Mark verified" }).click();
    await expect(page.getByRole("dialog").getByRole("alert").or(page.getByRole("dialog").getByLabel("Who confirmed them?"))).toBeVisible();
    await page.getByRole("dialog").getByLabel("Who confirmed them?").fill("Ms. Rivera");
    await page.getByRole("dialog").getByRole("button", { name: "Mark verified" }).click();
    await expect(row.getByText("Verified by Ms. Rivera")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit Sorting" })).toHaveCount(0);

    await page.locator(".entry", { hasText: XSS }).getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Submitted for sign-off")).toBeVisible();

    await page.goto("/");
    await expect(page.locator(".stat", { hasText: "Hours so far" }).locator(".stat-value")).toHaveText("5 hours");
    await expect(page.locator(".stat", { hasText: /^Verified/ }).locator(".stat-value")).toHaveText("4 hours");
    await expect(page.locator(".stat", { hasText: "Awaiting sign-off" }).locator(".stat-value")).toHaveText("1 hour");
    await expect(page.getByText("5 hours to go")).toBeVisible();
  });

  test("hours log filters, edits and deletes with confirmation", async ({ page }) => {
    await page.goto("/hours");
    await page.getByLabel("Status").selectOption("verified");
    await expect(page.locator(".entry")).toHaveCount(1);
    await page.getByLabel("Status").selectOption("");
    await page.getByLabel("Search").fill("library");
    await expect(page.locator(".entry")).toHaveCount(1);
    await page.getByLabel("Search").fill("");
    await logHours(page, "Park", "Cleanup", "2");
    await page.getByRole("button", { name: "Edit Cleanup" }).click();
    await page.getByRole("dialog").getByLabel("Activity").fill("River cleanup");
    await page.getByRole("dialog").getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("River cleanup")).toBeVisible();
    await page.getByRole("button", { name: "Delete River cleanup" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(".entry", { hasText: "River cleanup" })).toBeVisible();
    await page.getByRole("button", { name: "Delete River cleanup" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.locator(".entry", { hasText: "River cleanup" })).toHaveCount(0);
  });

  test("bad hours are refused with a clear message", async ({ page }) => {
    await page.goto("/hours");
    await page.getByRole("button", { name: "Log hours" }).first().click();
    const d = page.getByRole("dialog");
    await d.locator("form").evaluate((f) => ((f as HTMLFormElement).noValidate = true));
    await d.getByLabel("Organization").fill("X");
    await d.getByLabel("Activity").fill("Y");
    await d.getByLabel("Hours").fill("30");
    await d.getByRole("button", { name: "Log hours" }).click();
    await expect(d.getByRole("alert")).toContainText("between");
    await page.keyboard.press("Escape");
    await expect(d).toBeHidden();
  });

  test("opportunities: add, import, filter, go and log", async ({ page }) => {
    await page.goto("/opportunities");
    await addOpportunity(page, "City Shelter", "Dog walking", 3, "2", "14");
    await addOpportunity(page, "Far Farm", "Barn help", 40, "30", "18");

    await page.getByRole("button", { name: "Import school list" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("CSV file").setInputFiles({
      name: "list.csv", mimeType: "text/csv",
      buffer: Buffer.from(`organization,title,cause,date,start,end,location,distance_miles,min_age,max_age,details\nLibrary,Book sale,Education,${iso(10)},09:00,12:00,Main St,1.5,,,${XSS}\nBad,Row,Other,soon,,,,,,,\n`),
    });
    await dialog.getByRole("button", { name: "Preview" }).click();
    await expect(dialog.getByText("1 new, 0 already added, 1 with problems.")).toBeVisible();
    expect((await (await page.request.get("/api/opportunities")).json()).length).toBe(2);
    await dialog.getByRole("button", { name: "Add to list" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".opp")).toHaveCount(3);
    await expect(page.getByText(XSS)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

    await page.getByLabel("Cause").selectOption("Education");
    await expect(page.locator(".opp")).toHaveCount(1);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByLabel("Source").selectOption("school");
    await expect(page.locator(".opp")).toHaveCount(1);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByLabel("Within miles").fill("5");
    await expect(page.locator(".opp")).toHaveCount(2);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByLabel("My age").fill("15");
    await expect(page.locator(".opp", { hasText: "Barn help" })).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByLabel("From").fill(iso(5));
    await page.getByLabel("To").fill(iso(20));
    await expect(page.locator(".opp")).toHaveCount(1);
    await page.getByRole("button", { name: "Clear filters" }).click();

    const card = page.locator(".opp", { hasText: "Dog walking" });
    await card.getByRole("button", { name: "I'm going" }).click();
    await expect(card.getByRole("button", { name: "Going" })).toBeVisible();
    await page.goto("/");
    await expect(page.locator(".card", { hasText: "Next shift" })).toContainText("Dog walking");

    await page.goto("/opportunities");
    await page.locator(".opp", { hasText: "Dog walking" }).getByRole("button", { name: "Log hours" }).click();
    const log = page.getByRole("dialog");
    await expect(log.getByLabel("Organization")).toHaveValue("City Shelter");
    await expect(log.getByLabel("Hours")).toHaveValue("2.5");
    await log.getByRole("button", { name: "Cancel" }).click();
  });

  test("school items can't be edited; removing needs confirmation", async ({ page }) => {
    await page.goto("/opportunities");
    await expect(page.getByRole("button", { name: "Edit Book sale" })).toHaveCount(0);
    await page.getByRole("button", { name: "Remove Book sale" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
    await expect(page.locator(".opp", { hasText: "Book sale" })).toHaveCount(0);
  });

  test("data survives a reload", async ({ page }) => {
    await page.goto("/");
    await page.reload();
    await expect(page.locator(".stat", { hasText: "Hours so far" }).locator(".stat-value")).toHaveText("5 hours");
  });
});

test.describe("protections and layout", () => {
  test("writes without the request header are refused", async ({ page }) => {
    await page.goto("/");
    const status = await page.evaluate(async () => (await fetch("/api/goal", { method: "PUT", headers: { "Content-Type": "application/json" }, body: '{"hours":1}' })).status);
    expect(status).toBe(403);
  });

  test("a foreign hostname gets nothing", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: "http://127.0.0.1:18081", extraHTTPHeaders: { Host: "evil.example" } });
    expect((await ctx.get("/")).status()).toBe(403);
    expect((await ctx.get("/api/overview")).status()).toBe(403);
    await ctx.dispose();
  });

  test("no HHS or school branding appears", async ({ page }) => {
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("body")).not.toContainText(/Holliston|HHS/);
    }
  });

  for (const [name, width, height] of [["desktop", 1440, 900], ["laptop", 1280, 720], ["tablet", 768, 1024], ["mobile", 390, 844]] as const) {
    test(`${name}: no sideways scrolling`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      for (const route of ROUTES) {
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        const overflow = await page.evaluate(() => {
          const main = document.querySelector(".content")!;
          return Math.max(document.documentElement.scrollWidth - innerWidth, main.scrollWidth - main.clientWidth);
        });
        expect(overflow, route).toBeLessThanOrEqual(0);
      }
    });
  }

  test("menu buttons only appear on narrow screens, and the drawer works", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Open menu" })).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    const link = page.getByRole("link", { name: "Hours Log" });
    await expect(link).toBeHidden();
    await page.getByRole("button", { name: "Open menu" }).click();
    await link.click();
    await expect(page).toHaveURL(/hours$/);
    await expect(link).toBeHidden();
  });
});
