#!/usr/bin/env node
/**
 * Capture the running dashboard as design reference for coding agents.
 *
 * Writes `design/latest/*.png` + `manifest.json` (gitignored). Uses the system
 * Chrome via playwright-core, so no browser download is needed.
 *
 *   npm run design:shots                     # light+dark, desktop+mobile
 *   npm run design:shots -- --base http://nas:8765 --out /tmp/shots
 *
 * Auth: pass --cookie (the xboard_session value) or XBOARD_SESSION, otherwise
 * the script mints one locally with `python3 -c "from core.auth import ..."`.
 */
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const BASE = (flag("base", "http://127.0.0.1:8765") || "").replace(/\/+$/, "");
const OUT = resolve(ROOT, flag("out", "design/latest"));
const THEMES = (flag("themes", "light,dark") || "").split(",").filter(Boolean);
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

const PAGES = [
  { slug: "board", nav: "看板" },
  { slug: "tags", nav: "标签" },
  { slug: "jobs", nav: "任务" },
  { slug: "settings", nav: "设置" },
];

function sessionCookie() {
  if (flag("cookie")) return flag("cookie");
  if (process.env.XBOARD_SESSION) return process.env.XBOARD_SESSION;
  const res = spawnSync(
    "python3",
    ["-c", "from core.auth import create_token; print(create_token('admin'))"],
    { cwd: ROOT, encoding: "utf8" },
  );
  const token = res.stdout?.trim();
  if (!token) {
    throw new Error(
      "拿不到会话 cookie：服务器不在本机时请用 --cookie <xboard_session 值>",
    );
  }
  return token;
}

async function clickNav(page, label, viewport) {
  if (viewport === "mobile") {
    await page.locator('[data-slot="sidebar-trigger"]').click();
    await page.waitForTimeout(350);
  }
  await page.getByRole("button", { name: label, exact: true }).first().click();
  await page.waitForFunction(
    (name) => document.querySelector("h1")?.textContent?.trim() === name,
    label,
  );
  await settle(page);
}

/** Wait for images/animations so the frame is stable. */
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images).map((img) =>
        img.complete
          ? null
          : new Promise((done) => {
              img.onload = img.onerror = done;
            }),
      ),
    );
  });
  await page.waitForTimeout(350);
}

async function capture(page, shot, meta, out) {
  const file = `${shot}-${meta.theme}-${meta.viewport}.png`;
  await page.screenshot({ path: resolve(out, file) });
  return { ...meta, shot, file, ...page.viewportSize() };
}

async function main() {
  const cookie = sessionCookie();
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const entries = [];

  for (const [viewport, size] of Object.entries(VIEWPORTS)) {
    for (const theme of THEMES) {
      if (viewport === "mobile" && theme === "dark") continue; // 移动端深色与桌面同源
      const context = await browser.newContext({
        viewport: size,
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        colorScheme: theme,
      });
      await context.addCookies([
        { name: "xboard_session", value: cookie, url: BASE },
      ]);
      await context.addInitScript(
        (t) => localStorage.setItem("xboard-theme", t),
        theme,
      );
      const page = await context.newPage();
      page.on("dialog", (d) => d.dismiss());
      await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
      await settle(page);

      const meta = { theme, viewport };
      for (const { slug, nav } of PAGES) {
        await clickNav(page, nav, viewport);
        entries.push(await capture(page, slug, meta, OUT));
      }

      if (viewport === "desktop" && theme === "light") {
        await clickNav(page, "看板", viewport);
        // 详情页：卡片的更多操作 → 查看详情
        const card = page.locator("article").first();
        await card.hover();
        await card.locator('button[aria-label="更多操作"]').click();
        await page.getByRole("menuitem", { name: "查看详情" }).click();
        await settle(page);
        entries.push(await capture(page, "detail", meta, OUT));
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);

        // 添加推文对话框
        await page.getByRole("button", { name: "添加推文" }).click();
        await settle(page);
        entries.push(await capture(page, "add-post", meta, OUT));
      }

      await context.close();
    }
  }

  await browser.close();
  await writeFile(
    resolve(OUT, "manifest.json"),
    JSON.stringify(
      { base: BASE, capturedAt: new Date().toISOString(), shots: entries },
      null,
      2,
    ),
  );
  console.log(
    `captured ${entries.length} shots -> ${relative(process.cwd(), OUT)}`,
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
