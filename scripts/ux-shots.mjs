import { chromium } from "playwright";
const out = "/workspace/artifacts/ui-preview";
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 980 } });
page.setDefaultTimeout(20000);
await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
if (await page.locator("#em").count()) {
  await page.fill("#em", "admin@localhost.com");
  await page.fill("#pw", "changeme");
  await page.getByRole("button", { name: "Enter" }).click();
}
await page.waitForSelector("[data-owner-view]");
await page.waitForSelector("text=Here’s what needs you today");
await page.screenshot({ path: `${out}/home.png`, fullPage: true });

await page.getByRole("button", { name: "Start My Tasks" }).first().click();
await page.waitForSelector("text=What happened");
await page.screenshot({ path: `${out}/tasks.png`, fullPage: true });
await page.getByRole("button", { name: "Got it" }).click();
await page.waitForTimeout(400);

await page.locator("header").getByRole("button", { name: "Pipeline" }).click();
await page.waitForFunction(() => document.querySelector("[data-owner-view]")?.getAttribute("data-owner-view") === "pipe");
await page.screenshot({ path: `${out}/pipeline.png`, fullPage: true });

await page.getByRole("button", { name: "Review" }).first().click();
await page.waitForFunction(() => document.querySelector("[data-owner-view]")?.getAttribute("data-owner-view") === "detail");
await page.screenshot({ path: `${out}/review.png`, fullPage: true });

await page.locator("header").getByRole("button", { name: "Home" }).click();
await page.waitForFunction(() => document.querySelector("[data-owner-view]")?.getAttribute("data-owner-view") === "home");
await page.getByRole("button", { name: "Conversation" }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/ara.png`, fullPage: true });
console.log("view after ara", await page.getAttribute("[data-owner-view]", "data-owner-view"));
await browser.close();
console.log("shots ok");
