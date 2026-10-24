# Your Shop Name: card storefront + tracker

A small static site in plain HTML, CSS and JavaScript. There's no build step for the site itself, so it can be hosted anywhere.

| Page | What it is |
|---|---|
| `storefront.html` | Public. Searchable grid of cards for sale with asking prices. |
| `tracker.html` | Private. Record sales, see profit, set a status for each copy. |
| `labels.html` | Private. Design and print card labels or address labels. |
| `index.html` | Redirects to the storefront. |

```
index.html  storefront.html  tracker.html  labels.html
assets/        styles.css, common.js, storefront.js, tracker.js, labels.css, labels.js
data/          inventory.json (every copy, all fields), storefront.json (public fields only)
reports/       excluded.md (rows left off the storefront, and why)
source/        your workbook (.xlsx) or CollX export (.csv)
build/         build.py (makes data/ and reports/), check_public.py (privacy check)
tests/         storefront-render-check.mjs (optional browser check)
```

## Run it locally

The pages load their data with `fetch`, so open them through a local web server, not by double-clicking the file:

```sh
cd path/to/this/folder
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Update the card data

1. Put your updated file in `source/`. That can be the workbook (`.xlsx`, read from the **Inventory** tab) or a CollX collection export (`.csv`). The build uses the newest `.xlsx`/`.csv` in that folder, or you can give it a path.
2. Rebuild, then run the privacy check:

   ```sh
   python3 build/build.py                      # or: python3 build/build.py source/CollX_Inventory_Grading.xlsx
   python3 build/check_public.py
   ```

3. Read `reports/excluded.md`, then commit and push (or re-upload) the changed files.

The build needs only Python 3, with nothing to install. It never has a fixed card count, so any number of rows works.

**Workbook columns (Inventory tab):** `#`, `Copy`, `Player`, `Year / Set / Card`, `Raw market (CollX est.)`, `List price (ask)`, `Your cost`, `PSA 9 value`, `PSA 10 value`, `Flags`, `Status`. The header row can be anywhere near the top. Blank rows, and rows with no `#` and no player (such as totals), are skipped.

**CollX CSV export:** uses `name`, `set`, `number`, `market_value`, `asking_price`, `purchase_price`, `sold_for_price` and `flags`. The export has no Status column. A row with a `sold_for_price` counts as Sold and every other row counts as Available. If you add a `status` column, the build uses it.

### Copies and duplicates

- Every row is one physical card, and every row is kept.
- In the workbook, rows that share a `#` are copies of one card. The `Copy` column gives the copy number, and rows with a blank Copy get the next free number.
- In a CollX export, rows with the same player, year, set and card number are copies, numbered in file order.
- When a card has more than one copy, both pages show "Copy 2 of 2".
- If two rows have a blank Copy and every field matches exactly, the build keeps both. It lists them under "Possible duplicate entries" in `reports/excluded.md` so you can decide.

### What the storefront shows

The storefront shows only cards with Status **Available** and a list price. It leaves out unidentified cards (player or set blank or "Unidentified") and cards with no list price. Each card shows player, set/card, copy number (when there's more than one copy) and asking price. Asks of $20 or more get a **Top card** badge.

`data/storefront.json` contains only those public fields. Market values, costs, PSA values and profit never reach the storefront. `build/check_public.py` checks this after every build. For a check of the page as the browser renders it, install Playwright (`npm i -D playwright && npx playwright install chromium`) and run `node tests/storefront-render-check.mjs`.

## The tracker

- Fees are CollX 8%, Whatnot 10.9% + $0.30 per order, eBay 13.6%, Other 0%. To change them, edit `PLATFORMS` at the top of `assets/tracker.js`.
- Cost per card defaults to the row's cost from the workbook, or $0.50 if it has none.
- Recording a sale marks that copy Sold. Deleting a sale puts it back to its previous status. Changing a status in the inventory table never records a sale.
- Sales and statuses are saved in `localStorage`, so they stay **in this browser on this device only**. They don't change the public storefront. To take a card off the storefront, change its Status in the workbook and rebuild.

## Label studio

Open **Labels** in the nav.

1. **What to print:** *Card labels* come from your inventory. *Address labels* come from addresses you type, with a blank line between each one.
2. **Label stock:** choose your paper.
   - Regular inkjet or laser printers: Avery 5160/8160 (30 per sheet), 5167/8167 (80 tiny labels), 5163/8163 (10 large).
   - Thermal label printers: Dymo, Rollo or Zebra roll sizes, a 4×6 shipping label, or a custom size.
   - On a sheet, **Start at label** skips spots you've already used.
3. **Card label design:** choose the shop name and which lines to show (set, copy number, price, ✦ Top card mark), a frame, and gold or black ink. Picking a thermal size switches ink to black, because thermal printers can't print color.
4. **Choose cards:** search, filter by status, then tick cards or use **Select shown**. Statuses changed on the tracker are respected in this browser.
5. Click **Print labels**. In the print dialog, set Scale to **100% / Actual size**, Margins to **None**, and turn headers and footers **off**. For thermal printers, pick the label size as the paper size.

Text shrinks automatically to fit each label. If anything ends up smaller than 6pt, the page warns you. The first time you use a new sheet type, print one page on plain paper with **Print outlines** on, hold it over a label sheet, and adjust **Fine-tune alignment** if it's off. Label settings are saved in this browser.

## Deploy

Before deploying, note that **anyone with the URL can open `tracker.html` and `data/inventory.json`.** That file includes your market values and costs, and the `source/` file is also public if you publish the whole folder. The tracker and label pages ask search engines not to index them, but that isn't access control. If those numbers must stay private, deploy only the storefront files: `index.html`, `storefront.html`, `assets/common.js`, `assets/storefront.js`, `assets/styles.css` and `data/storefront.json`. Then run the tracker locally with `python3 -m http.server`.

**GitHub Pages:** push this folder to a GitHub repo, then go to **Settings → Pages → Build and deployment**. Choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save. The site appears at `https://<user>.github.io/<repo>/` within a minute or two. A public repo also makes `source/` and `data/inventory.json` public on GitHub itself.

**Railway:** the repo includes a `Dockerfile` and `Caddyfile`, so Railway runs a Caddy web server automatically. It serves only the site files: `source/`, `build/`, `reports/` and `tests/` are not served.
1. Go to **New Project → Deploy from GitHub repo**, pick this repo, and set **Settings → Source** to the `main` branch.
2. Leave **Variables** empty. Railway sets `PORT` itself and the server listens on it.
3. Under **Settings → Networking**, click **Generate Domain**. If Railway asks for a port, leave it on the port it detects. If you get a 502, edit the domain and set the port to the number after `PORT` in the deploy logs, or add a variable `PORT` = `8080` and set the domain port to `8080`.

**Netlify:** drag this folder onto <https://app.netlify.com/drop>. Or connect the repo with an empty build command and publish directory `.`. To re-deploy after a data update, drag the folder again or push to the connected repo.

## Customize

- **Shop name:** replace "Your Shop Name" in `storefront.html` (in `<title>`, the nav and the `<h1>`), `tracker.html` and `labels.html`. Set the name printed on labels in the label studio itself.
- **Shop buttons:** replace the two `https://example.com/...` links in `storefront.html` with your CollX and Whatnot shop URLs.
- **Tagline:** the `<p class="tagline">` in `storefront.html`.
- **Colors and fonts:** the variables at the top of `assets/styles.css` (ivory, ink and gold, with Cormorant Garamond and Jost from Google Fonts). Light and dark mode follow the system setting.
- **Private links:** to hide Tracker and Labels from the public nav, delete their `<li>` items from `storefront.html`.
