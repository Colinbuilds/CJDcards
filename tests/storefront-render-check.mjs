// Renders storefront.html in a real browser and searches the built HTML for private values.
// Optional; needs Playwright:  npm i -D playwright && npx playwright install chromium
// Run from the site folder:     node tests/storefront-render-check.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright"); // require() also finds a global install via NODE_PATH

const root = fileURLToPath(new URL("..", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const path = normalize(join(root, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  if (!path.startsWith(root)) return res.writeHead(403).end();
  try {
    res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" }).end(await readFile(path));
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const base = `http://localhost:${server.address().port}`;

const inventory = JSON.parse(await readFile(join(root, "data/inventory.json"), "utf8")).cards;
const storefront = JSON.parse(await readFile(join(root, "data/storefront.json"), "utf8")).cards;
const fmt = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const publicAsks = new Set(storefront.map((c) => fmt(c.ask)));
const privateValues = new Map(); // "$0.99" -> fields
for (const c of inventory) {
  for (const f of ["market", "cost", "psa9", "psa10", "soldFor"]) {
    if (typeof c[f] === "number") privateValues.set(fmt(c[f]), (privateValues.get(fmt(c[f])) || new Set()).add(f));
  }
}

const problems = [];
const browser = await chromium.launch();
for (const [width, scheme] of [[375, "light"], [375, "dark"], [1280, "light"]]) {
  const page = await browser.newPage({ viewport: { width, height: 800 }, colorScheme: scheme });
  // Block Google Fonts so the check works offline; layout falls back to system fonts.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  page.on("pageerror", (e) => problems.push(`${width}px ${scheme}: page error ${e.message}`));
  await page.goto(`${base}/storefront.html`);
  await page.waitForSelector("#cards .card");

  const html = await page.content();
  const text = await page.locator("body").innerText();
  const cards = await page.$$eval("#cards .card", (els) => els.map((e) => ({
    player: e.querySelector("h3").textContent,
    setCard: e.querySelector(".set").textContent,
    copy: e.querySelector(".copy")?.textContent || "",
    price: e.querySelector(".price").firstChild.textContent,
    top: e.classList.contains("is-top"),
    money: e.textContent.match(/\$[\d,]+\.\d\d/g) || [],
  })));

  if (cards.length !== storefront.length) problems.push(`${width}px: ${cards.length} cards shown, expected ${storefront.length}`);
  for (const shown of cards) {
    const match = storefront.find((c) => c.player === shown.player && c.setCard === shown.setCard &&
      (c.copies > 1 ? shown.copy === `Copy ${c.copy} of ${c.copies}` : shown.copy === "") && fmt(c.ask) === shown.price);
    if (!match) problems.push(`card "${shown.player} ${shown.setCard} ${shown.copy}" shows ${shown.price}, not its ask`);
    else if (match.top !== shown.top || match.top !== match.ask >= 20) problems.push(`card "${shown.player}" Top card badge wrong`);
    if (shown.money.length !== 1) problems.push(`card "${shown.player}" shows ${shown.money.length} dollar amounts`);
  }
  for (const [value, fields] of privateValues) {
    if (html.includes(value) && !publicAsks.has(value)) problems.push(`page HTML contains ${value} (${[...fields]})`);
  }
  for (const word of ["market", "cost", "psa", "profit"]) {
    if (text.toLowerCase().includes(word)) problems.push(`visible text mentions "${word}"`);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) problems.push(`${width}px ${scheme}: page scrolls sideways by ${overflow}px`);

  const name = storefront[0].player;
  await page.fill("#search", name.toLowerCase());
  const found = await page.$$eval("#cards .card h3", (els) => els.map((e) => e.textContent));
  if (!found.length || found.some((p) => !p.toLowerCase().includes(name.toLowerCase()))) problems.push(`search for "${name}" returned ${found}`);
  await page.close();
}
await browser.close();
server.close();

console.log(`Rendered storefront with ${storefront.length} cards; searched its HTML for ${privateValues.size} private amounts.`);
if (problems.length) {
  console.log("FAIL");
  for (const p of [...new Set(problems)]) console.log("  -", p);
  process.exit(1);
}
console.log("PASS: every price shown is that card's own ask; no private amounts or words on the page; no sideways scroll.");
