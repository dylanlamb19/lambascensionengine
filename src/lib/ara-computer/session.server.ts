import type { Browser, BrowserContext, Page } from "playwright";
import { clickAllowed, controlRisk, pointerAllowed, selectorRejected } from "./guard";
import {
  isBlockedHeading,
  isForbiddenOrigin,
  lookingAtLabel,
  loopbackOrigin,
  operatorUrl,
  safeLookingAt,
} from "./origin";
import type { ComputerActInput, ComputerDriver, ComputerSnapshot, VisibleControl } from "./types";

const VIEW_W = 1100;
const VIEW_H = 820;

type Session = {
  userId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  driver: ComputerDriver;
  gen: number;
  lastShot: string;
  lastControls: VisibleControl[];
  lookingAt: string;
  origin: string;
};

const sessions = new Map<string, Session>();
const locks = new Map<string, Promise<void>>();

async function withLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(userId) || Promise.resolve();
  let release: () => void = () => {};
  const curr = new Promise<void>((res) => {
    release = res;
  });
  locks.set(userId, prev.then(() => curr));
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Isolated computer always loads this process’s Lamb Ascension — never x.ai / grok.com. */
function appOrigin(): string {
  return loopbackOrigin(process.env.PORT || "8080");
}

function homeUrl(origin: string): string {
  return operatorUrl(origin);
}

async function attachGuards(context: BrowserContext, origin: string) {
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (isForbiddenOrigin(url)) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  context.on("page", (p) => {
    p.on("framenavigated", (frame) => {
      if (frame !== p.mainFrame()) return;
      if (isForbiddenOrigin(frame.url())) {
        void p.goto(homeUrl(origin), { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
      }
    });
  });
}

async function ensureLambAscension(page: Page, origin: string) {
  const target = homeUrl(origin);
  if (isForbiddenOrigin(page.url())) {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 20000 });
  }
  await page.waitForSelector("[data-owner-view], [data-la-signin]", { timeout: 10000 }).catch(() => null);
  if (await page.locator("[data-owner-view]").count()) {
    await page.waitForSelector("[data-la-operator='1']", { timeout: 8000 }).catch(() => null);
    await page.waitForFunction(() => !document.querySelector("[data-ara-workspace]"), { timeout: 4000 }).catch(() => null);
    return;
  }
  const email = page.locator("#em");
  if (await email.count()) {
    const user = process.env.OWNER_EMAIL || "admin@localhost.com";
    const pass = process.env.OWNER_PASSWORD || "changeme";
    await email.fill(user);
    await page.locator("#pw").fill(pass);
    await page.locator('form button[type="submit"]').click();
    await page.waitForSelector("[data-owner-view]", { timeout: 12000 }).catch(() => null);
  } else if (isForbiddenOrigin(page.url()) || isBlockedHeading(await page.title().catch(() => ""))) {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForSelector("[data-owner-view], [data-la-signin]", { timeout: 8000 }).catch(() => null);
  }
}

async function launchPage(origin: string, bearer: string): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const context = await browser.newContext({
    viewport: { width: VIEW_W, height: VIEW_H },
    deviceScaleFactor: 1,
  });
  await attachGuards(context, origin);
  await context.addInitScript(() => {
    try {
      (window as unknown as { __LA_OPERATOR?: boolean }).__LA_OPERATOR = true;
      document.documentElement.setAttribute("data-la-operator", "1");
    } catch {
      /* ignore */
    }
  });
  if (bearer) {
    await context.addInitScript((token) => {
      try {
        sessionStorage.setItem("grok-auth.bearer-token", token);
      } catch {
        /* ignore */
      }
    }, bearer);
  }
  const page = await context.newPage();
  await page.goto(homeUrl(origin), { waitUntil: "domcontentloaded", timeout: 20000 });
  await ensureLambAscension(page, origin);
  await page.waitForTimeout(350);
  return { browser, context, page };
}

async function pageMeta(page: Page) {
  return page
    .evaluate(() => {
      const root = document.querySelector("[data-owner-view]");
      const buttons = [...document.querySelectorAll("button, a[href], [role='button']")]
        .slice(0, 36)
        .map((el, i) => {
          const r = el.getBoundingClientRect();
          return {
            id: `c${i}`,
            name: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
            role: el.tagName.toLowerCase(),
            x: Math.round(r.x + r.width / 2),
            y: Math.round(r.y + r.height / 2),
          };
        })
        .filter((c) => c.name);
      return {
        url: location.href,
        title: document.title,
        view: root?.getAttribute("data-owner-view") || "",
        openUid: root?.getAttribute("data-open-uid") || "",
        companyName: root?.getAttribute("data-company-name") || "",
        evidence: root?.getAttribute("data-evidence") === "1",
        app: document.querySelector("[data-la-app]")?.getAttribute("data-la-app") || "",
        heading: document.querySelector("h1, h2, .font-display")?.textContent?.trim().slice(0, 80) || "",
        buttons,
      };
    })
    .catch(() => ({
      url: page.url(),
      title: "",
      view: "",
      openUid: "",
      companyName: "",
      evidence: false,
      app: "",
      heading: "",
      buttons: [] as { id: string; name: string; role: string; x: number; y: number }[],
    }));
}

function sessionOnForbiddenPage(url: string, heading: string, app: string): boolean {
  if (isForbiddenOrigin(url) || isBlockedHeading(heading) || isBlockedHeading(url)) return true;
  if (app && app !== "lamb-ascension") return true;
  return false;
}

async function snapshotOf(session: Session): Promise<ComputerSnapshot> {
  const page = session.page;
  if (isForbiddenOrigin(page.url())) {
    await page.goto(homeUrl(session.origin), { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
    await ensureLambAscension(page, session.origin);
  }
  let meta = await pageMeta(page);
  if (sessionOnForbiddenPage(meta.url, meta.heading, meta.app)) {
    await page.goto(homeUrl(session.origin), { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null);
    await ensureLambAscension(page, session.origin);
    meta = await pageMeta(page);
  }

  let jpeg = "";
  const pageIsLa = !sessionOnForbiddenPage(meta.url, meta.heading, meta.app);
  if (pageIsLa) {
    try {
      const buf = await page.screenshot({ type: "jpeg", quality: 42 });
      jpeg = buf.toString("base64");
      session.lastShot = jpeg;
    } catch {
      jpeg = session.lastShot;
    }
  } else {
    jpeg = "";
  }

  const controls: VisibleControl[] = (meta.buttons || []).map((b) => ({
    ...b,
    risk: controlRisk(b.name),
  }));
  session.lastControls = controls;
  const looking = safeLookingAt(
    lookingAtLabel({
      view: meta.view,
      companyName: meta.companyName,
      evidence: meta.evidence,
      heading: meta.heading,
      url: meta.url,
    }),
  );
  session.lookingAt = looking;
  return {
    ok: pageIsLa,
    reason: pageIsLa ? undefined : "Ara’s computer bounced off a blocked page and is reopening Lamb Ascension.",
    jpeg: pageIsLa ? jpeg : undefined,
    url: pageIsLa ? meta.url : session.origin,
    title: meta.title,
    view: meta.view,
    openUid: meta.openUid,
    lookingAt: looking,
    driver: session.driver,
    controls,
    width: VIEW_W,
    height: VIEW_H,
  };
}

async function closeSession(userId: string) {
  const session = sessions.get(userId);
  if (!session) return;
  sessions.delete(userId);
  try {
    await session.browser.close();
  } catch {
    /* ignore */
  }
}

function existingIsHealthy(session: Session): boolean {
  try {
    const url = session.page.url();
    if (isForbiddenOrigin(url)) return false;
    if (!url.startsWith(session.origin) && !url.includes("127.0.0.1") && !url.includes("localhost")) return false;
    return true;
  } catch {
    return false;
  }
}

async function existingReady(session: Session): Promise<boolean> {
  if (!existingIsHealthy(session)) return false;
  try {
    const nested = await session.page.locator("[data-ara-workspace]").count();
    if (nested) return false;
    const op = await session.page.locator("[data-la-operator='1']").count();
    if (!op) return false;
    return true;
  } catch {
    return false;
  }
}

export async function startComputer(userId: string, _clientOrigin: string, bearer: string): Promise<ComputerSnapshot> {
  return withLock(userId, async () => {
    const origin = appOrigin();
    const existing = sessions.get(userId);
    if (existing && (await existingReady(existing))) {
      existing.driver = existing.driver === "stopped" ? "ara" : existing.driver;
      return snapshotOf(existing);
    }
    if (existing) await closeSession(userId);
    try {
      const launched = await launchPage(origin, bearer);
      const session: Session = {
        userId,
        ...launched,
        driver: "ara",
        gen: 0,
        lastShot: "",
        lastControls: [],
        lookingAt: "Ara is looking at Home",
        origin,
      };
      sessions.set(userId, session);
      return snapshotOf(session);
    } catch {
      return {
        ok: false,
        reason: "Ara’s computer isn’t available here. Buttons and conversation still work.",
        driver: "stopped",
        controls: [],
        width: VIEW_W,
        height: VIEW_H,
        lookingAt: "Ara’s computer isn’t running",
      };
    }
  });
}

export async function stopComputer(userId: string): Promise<void> {
  const session = sessions.get(userId);
  if (!session) return;
  session.driver = "stopped";
  session.gen += 1;
  await closeSession(userId);
}

export async function getSnapshot(userId: string): Promise<ComputerSnapshot> {
  const session = sessions.get(userId);
  if (!session) {
    return { ok: false, reason: "Ara’s computer is not running.", driver: "stopped", controls: [], width: VIEW_W, height: VIEW_H, lookingAt: "Ara’s computer isn’t running" };
  }
  return snapshotOf(session);
}

export async function actComputer(userId: string, input: ComputerActInput): Promise<ComputerSnapshot & { blocked?: string; event?: string }> {
  return withLock(userId, async () => {
    const session = sessions.get(userId);
    if (!session) {
      return { ok: false, reason: "Ara’s computer is not running.", driver: "stopped", controls: [], width: VIEW_W, height: VIEW_H, lookingAt: "Ara’s computer isn’t running" };
    }
    const page = session.page;
    const op = input.op;

    if (op === "stop") {
      session.driver = "stopped";
      session.gen += 1;
      const shot = await snapshotOf(session);
      return { ...shot, event: "STOP" };
    }
    if (op === "take_control") {
      session.driver = "human";
      session.gen += 1;
      const shot = await snapshotOf(session);
      return { ...shot, event: "TAKE_CONTROL" };
    }
    if (op === "give_control") {
      session.driver = "ara";
      const shot = await snapshotOf(session);
      return { ...shot, event: "GIVE_CONTROL" };
    }

    if (op === "pointer") {
      const allow = pointerAllowed(session.driver);
      if (!allow.ok) return { ...(await snapshotOf(session)), blocked: allow.reason };
      const x = Number(input.x || 0);
      const y = Number(input.y || 0);
      const kind = input.pointer || "click";
      if (kind === "move") await page.mouse.move(x, y);
      else if (kind === "down") await page.mouse.down();
      else if (kind === "up") await page.mouse.up();
      else await page.mouse.click(x, y);
      return snapshotOf(session);
    }

    if (session.driver !== "ara" && op !== "inspect") {
      const allow = clickAllowed("action", session.driver);
      return { ...(await snapshotOf(session)), blocked: allow.ok ? undefined : allow.reason };
    }

    if (op === "inspect") {
      return snapshotOf(session);
    }

    if (op === "scroll") {
      await page.mouse.wheel(0, input.dy ?? 520);
      await page.waitForTimeout(120);
      return { ...(await snapshotOf(session)), event: "SCROLL" };
    }

    if (op === "type") {
      const text = String(input.text || "").slice(0, 400);
      if (text) await page.keyboard.type(text, { delay: 12 });
      return { ...(await snapshotOf(session)), event: "TYPE" };
    }

    if (op === "back") {
      const back = page.getByRole("button", { name: /back|got it/i }).first();
      if (await back.count()) await back.click({ timeout: 2500 }).catch(() => null);
      else {
        await page.goBack({ timeout: 2500 }).catch(() => null);
        if (isForbiddenOrigin(page.url())) {
          await page.goto(homeUrl(session.origin), { waitUntil: "domcontentloaded" }).catch(() => null);
        }
      }
      await page.waitForTimeout(200);
      return { ...(await snapshotOf(session)), event: "BACK" };
    }

    if (op === "navigate" && input.name) {
      if (isForbiddenOrigin(input.name) || /x\.ai|grok\.com/i.test(input.name)) {
        return { ...(await snapshotOf(session)), blocked: "Ara’s computer only opens Lamb Ascension." };
      }
      const nav = page.getByRole("button", { name: input.name }).first();
      if (await nav.count()) await nav.click({ timeout: 2500 });
      await page.waitForTimeout(200);
      return snapshotOf(session);
    }

    if (op === "dispatch" && input.action) {
      if (input.action.name && /x\.ai|grok\.com/i.test(input.action.name)) {
        return { ...(await snapshotOf(session)), blocked: "Ara’s computer only opens Lamb Ascension." };
      }
      await page
        .evaluate((action) => {
          const w = window as unknown as { __LA_DISPATCH?: (a: unknown) => void };
          w.__LA_DISPATCH?.(action);
        }, input.action)
        .catch(() => null);
      await page.waitForTimeout(280);
      return { ...(await snapshotOf(session)), event: `DISPATCH ${input.action.name}` };
    }

    if (op === "click") {
      if (selectorRejected(input as unknown as Record<string, unknown>)) {
        return { ...(await snapshotOf(session)), blocked: "Ara cannot use raw page selectors. She can click a named button she can see." };
      }
      const name = String(input.name || session.lastControls.find((c) => c.id === input.controlId)?.name || "").trim();
      if (!name) return { ...(await snapshotOf(session)), blocked: "I don’t see which control to use." };
      const allow = clickAllowed(name, session.driver);
      if (!allow.ok) return { ...(await snapshotOf(session)), blocked: allow.reason, event: "CLICK_BLOCKED" };
      const loc = page.getByRole("button", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") })
        .or(page.getByRole("button", { name }))
        .or(page.getByText(name, { exact: true }));
      try {
        await loc.first().click({ timeout: 3000 });
      } catch {
        return { ...(await snapshotOf(session)), blocked: `I can see the screen but couldn’t press “${name}”.` };
      }
      await page.waitForTimeout(200);
      return { ...(await snapshotOf(session)), event: `CLICK ${name}` };
    }

    return snapshotOf(session);
  });
}

export function computerDriver(userId: string): ComputerDriver {
  return sessions.get(userId)?.driver || "stopped";
}
