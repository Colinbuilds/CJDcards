/* Label studio: card labels from data/inventory.json, or address labels from typed text.
   Lays labels out in real inches so the browser's print dialog prints them to size. */
(function () {
  "use strict";
  const { money, copyLabel, loadJSON, el } = window.Shop;

  const STORAGE_KEY = "cardLabels.v1";
  const TRACKER_KEY = "cardTracker.v1";
  const STATUSES = ["Available", "Listed", "Sold", "Pulled", "Graded"];
  const TOP_CARD_ASK = 20;
  const PX_PER_IN = 96;

  // Sizes in inches. Sheet stock: Letter paper with a grid of labels. Roll stock: one label per page.
  const PRESETS = [
    { id: "avery5160", name: "Avery 5160 / 8160 · 1″ × 2⅝″ · 30 per sheet", page: [8.5, 11], label: [2.625, 1], cols: 3, rows: 10, left: 0.1875, top: 0.5, hgap: 0.125, vgap: 0 },
    { id: "avery5167", name: "Avery 5167 / 8167 · ½″ × 1¾″ · 80 per sheet", page: [8.5, 11], label: [1.75, 0.5], cols: 4, rows: 20, left: 0.3, top: 0.5, hgap: 0.3, vgap: 0 },
    { id: "avery5163", name: "Avery 5163 / 8163 · 2″ × 4″ · 10 per sheet", page: [8.5, 11], label: [4, 2], cols: 2, rows: 5, left: 0.15625, top: 0.5, hgap: 0.1875, vgap: 0 },
    { id: "roll-225x125", name: "Thermal roll · 2¼″ × 1¼″ (Dymo 30334, Rollo, Zebra)", label: [2.25, 1.25], roll: true },
    { id: "roll-35x1125", name: "Thermal roll · 3½″ × 1⅛″ address (Dymo 30252)", label: [3.5, 1.125], roll: true },
    { id: "roll-2125x1", name: "Thermal roll · 2⅛″ × 1″ (Dymo 30336)", label: [2.125, 1], roll: true },
    { id: "roll-4x6", name: "Thermal · 4″ × 6″ shipping label", label: [4, 6], roll: true },
    { id: "custom", name: "Custom roll size…", label: [2, 1], roll: true, custom: true },
  ];

  const DEFAULTS = {
    mode: "cards", preset: "avery5160", customW: 2, customH: 1, start: 1, copies: 1,
    shopName: "CJDcards", showShop: true, showSet: true, showCopy: true, showPrice: true, showTop: true,
    frame: "hairline", ink: "gold", addresses: "", selected: [], status: "Available",
    nudgeX: 0, nudgeY: 0, outlines: false,
  };

  const $ = (id) => document.getElementById(id);
  let state = { ...DEFAULTS };
  let cards = [];
  let trackerStatuses = {};

  // ---------- storage ----------

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && typeof saved === "object") state = { ...DEFAULTS, ...saved };
      if (state.shopName === "Your Shop Name") state.shopName = DEFAULTS.shopName; // old placeholder
    } catch (err) {
      warn("Saved label settings couldn't be read, so defaults are in use.");
    }
    try {
      const tracker = JSON.parse(localStorage.getItem(TRACKER_KEY) || "null");
      trackerStatuses = (tracker && tracker.statuses) || {};
    } catch (err) {
      trackerStatuses = {};
    }
  }

  let saveWarned = false;
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      if (!saveWarned) warn("Settings can't be saved in this browser. Labels still print; settings reset when you leave.");
      saveWarned = true;
    }
  }

  function warn(message) {
    const box = $("storage-warning");
    box.textContent = message;
    box.hidden = false;
  }

  // ---------- helpers ----------

  const statusOf = (card) => trackerStatuses[card.id] || card.status || "Available";
  const clampNum = (v, min, max, fallback) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };

  function preset() {
    const p = PRESETS.find((x) => x.id === state.preset) || PRESETS[0];
    if (!p.custom) return p;
    return { ...p, label: [clampNum(state.customW, 0.5, 8.5, 2), clampNum(state.customH, 0.3, 11, 1)] };
  }

  function sortedCards() {
    // Unidentified cards (no player) go last.
    return [...cards].sort((a, b) =>
      (!a.player - !b.player) || (a.player || "").localeCompare(b.player || "") || (a.setCard || "").localeCompare(b.setCard || "") || a.copy - b.copy);
  }

  // ---------- controls ----------

  function fillControls() {
    for (const p of PRESETS) $("preset").append(el("option", { value: p.id, text: p.name }));
    for (const s of STATUSES) $("card-status").append(el("option", { value: s, text: s }));
    document.querySelector(`input[name="mode"][value="${state.mode}"]`).checked = true;
    $("preset").value = state.preset;
    $("custom-w").value = state.customW;
    $("custom-h").value = state.customH;
    $("start").value = state.start;
    $("copies").value = state.copies;
    $("shop-name").value = state.shopName;
    $("show-shop").checked = state.showShop;
    $("show-set").checked = state.showSet;
    $("show-copy").checked = state.showCopy;
    $("show-price").checked = state.showPrice;
    $("show-top").checked = state.showTop;
    $("frame").value = state.frame;
    $("ink").value = state.ink;
    $("addresses").value = state.addresses;
    $("card-status").value = state.status;
    $("nudge-x").value = state.nudgeX;
    $("nudge-y").value = state.nudgeY;
    $("outlines").checked = state.outlines;
  }

  function readControls() {
    state.mode = document.querySelector('input[name="mode"]:checked').value;
    const presetChanged = state.preset !== $("preset").value;
    state.preset = $("preset").value;
    state.customW = clampNum($("custom-w").value, 0.5, 8.5, state.customW);
    state.customH = clampNum($("custom-h").value, 0.3, 11, state.customH);
    state.start = Math.round(clampNum($("start").value, 1, 999, 1));
    state.copies = Math.round(clampNum($("copies").value, 1, 50, 1));
    state.shopName = $("shop-name").value;
    state.showShop = $("show-shop").checked;
    state.showSet = $("show-set").checked;
    state.showCopy = $("show-copy").checked;
    state.showPrice = $("show-price").checked;
    state.showTop = $("show-top").checked;
    state.frame = $("frame").value;
    state.ink = $("ink").value;
    state.addresses = $("addresses").value;
    state.status = $("card-status").value;
    state.nudgeX = clampNum($("nudge-x").value, -0.5, 0.5, 0);
    state.nudgeY = clampNum($("nudge-y").value, -0.5, 0.5, 0);
    state.outlines = $("outlines").checked;
    // Thermal printers can't print gold; switch to black when picking roll stock.
    if (presetChanged && preset().roll) {
      state.ink = "black";
      $("ink").value = "black";
    }
  }

  function syncVisibility() {
    const p = preset();
    for (const box of document.querySelectorAll("[data-mode]")) box.hidden = box.dataset.mode !== state.mode;
    $("custom-size").hidden = !p.custom;
    $("start-field").hidden = !!p.roll;
  }

  function renderPicker() {
    const list = $("card-list");
    const terms = $("card-search").value.toLowerCase().split(/\s+/).filter(Boolean);
    const selected = new Set(state.selected);
    const shown = sortedCards().filter((c) => {
      if (state.status && statusOf(c) !== state.status) return false;
      const hay = `${c.player} ${c.setCard} ${c.number} ${copyLabel(c)}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    const items = shown.map((c) => {
      const meta = [c.setCard, copyLabel(c), c.ask != null ? money(c.ask) : "no price", statusOf(c)].filter(Boolean).join(" · ");
      return el("li", {},
        el("label", { class: "choice" },
          el("input", { type: "checkbox", value: c.id, checked: selected.has(c.id) }),
          el("span", {}, el("span", { class: "pick-name", text: c.player || "Unidentified" }), el("span", { class: "pick-meta", text: meta }))));
    });
    if (!items.length) items.push(el("li", { class: "empty-row", text: "No cards match." }));
    list.replaceChildren(...items);
    list.dataset.shown = JSON.stringify(shown.map((c) => c.id));
    $("pick-count").textContent = `${state.selected.length} selected · ${shown.length} shown`;
  }

  // ---------- labels ----------

  function labelItems() {
    const items = [];
    if (state.mode === "cards") {
      const chosen = new Set(state.selected);
      for (const c of sortedCards().filter((x) => chosen.has(x.id))) {
        for (let i = 0; i < state.copies; i++) items.push({ kind: "card", card: c });
      }
    } else {
      const blocks = state.addresses.split(/\n\s*\n/).map((b) => b.split("\n").map((l) => l.trim()).filter(Boolean)).filter((b) => b.length);
      for (const lines of blocks) {
        for (let i = 0; i < state.copies; i++) items.push({ kind: "address", lines });
      }
    }
    return items;
  }

  function cardLabel(c) {
    const inner = el("div", { class: "lbl-inner" });
    if (state.showShop && state.shopName.trim()) inner.append(el("div", { class: "l-shop", text: state.shopName.trim() }));
    inner.append(el("div", { class: "l-player", text: c.player || "Unidentified" }));
    if (state.showSet && c.setCard) inner.append(el("div", { class: "l-set", text: c.setCard }));
    const copy = state.showCopy ? copyLabel(c) : "";
    const top = state.showTop && c.ask != null && c.ask >= TOP_CARD_ASK;
    const price = state.showPrice && c.ask != null;
    if (copy || top || price) {
      inner.append(el("div", { class: "l-foot" },
        copy ? el("span", { class: "l-copy", text: copy }) : null,
        top ? el("span", { class: "l-top", text: "✦", "aria-label": "Top card" }) : null,
        price ? el("span", { class: "l-price", text: money(c.ask) }) : null));
    }
    return inner;
  }

  function addressLabel(lines) {
    return el("div", { class: "lbl-inner" }, ...lines.map((l) => el("div", { class: "l-line", text: l })));
  }

  // Largest font size (pt) at which the label's content fits, by binary search.
  function fit(inner, maxPt) {
    let lo = 3, hi = maxPt;
    const fits = () => inner.scrollHeight <= inner.clientHeight + 0.5 && inner.scrollWidth <= inner.clientWidth + 0.5;
    inner.style.fontSize = hi + "pt";
    if (fits()) return hi;
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2;
      inner.style.fontSize = mid + "pt";
      if (fits()) lo = mid; else hi = mid;
    }
    inner.style.fontSize = lo + "pt";
    return lo;
  }

  function render() {
    const p = preset();
    const [w, h] = p.label;
    const page = p.roll ? [w, h] : p.page;
    const perPage = p.roll ? 1 : p.cols * p.rows;
    const skip = p.roll ? 0 : Math.min(state.start - 1, perPage - 1);
    const items = labelItems();
    const pages = items.length ? Math.ceil((skip + items.length) / perPage) : 0;

    $("page-size").textContent = `@page { size: ${page[0]}in ${page[1]}in; margin: 0; }`;
    const sheetsBox = $("sheets");
    sheetsBox.classList.toggle("show-outlines", state.outlines);

    const pad = Math.min(w, h) * 0.09;
    const frameInset = Math.min(w, h) * 0.04;
    const maxPt = Math.min(22, h * 72 * 0.22);
    const frames = [];
    const fitTargets = [];
    let index = 0;
    for (let pg = 0; pg < pages; pg++) {
      const sheet = el("div", { class: "sheet" });
      sheet.style.width = page[0] + "in";
      sheet.style.height = page[1] + "in";
      const start = pg === 0 ? skip : 0;
      for (let slot = start; slot < perPage && index < items.length; slot++, index++) {
        const item = items[index];
        const col = p.roll ? 0 : slot % p.cols;
        const row = p.roll ? 0 : Math.floor(slot / p.cols);
        const left = (p.roll ? 0 : p.left + col * (w + p.hgap)) + state.nudgeX;
        const top = (p.roll ? 0 : p.top + row * (h + p.vgap)) + state.nudgeY;
        const isCard = item.kind === "card";
        const lbl = el("div", {
          class: `lbl ${isCard ? "lbl-card" : "lbl-address"} ink-${isCard ? state.ink : "black"} frame-${isCard ? state.frame : "none"}`,
        });
        Object.assign(lbl.style, { left: left + "in", top: top + "in", width: w + "in", height: h + "in" });
        lbl.style.setProperty("--frame-inset", frameInset + "in");
        const inner = isCard ? cardLabel(item.card) : addressLabel(item.lines);
        const framePad = isCard && state.frame !== "none" ? frameInset * 1.6 : 0;
        inner.style.padding = `${pad + framePad * 0.5}in ${pad + framePad}in`;
        if (isCard) inner.style.textAlign = "center";
        lbl.append(inner);
        sheet.append(lbl);
        fitTargets.push(inner);
      }
      const frame = el("div", { class: "sheet-frame" }, sheet);
      frames.push(frame, el("p", { class: "sheet-caption", text: p.roll ? `Label ${pg + 1} of ${pages}` : `Sheet ${pg + 1} of ${pages}` }));
    }
    if (!pages) {
      frames.push(el("p", { class: "empty", text: state.mode === "cards" ? "Choose cards to see your labels." : "Type an address to see your labels." }));
    }
    sheetsBox.replaceChildren(...frames);

    // Fit text now that labels are in the page at their real size.
    let smallest = Infinity;
    for (const inner of fitTargets) smallest = Math.min(smallest, fit(inner, maxPt));
    const warning = $("fit-warning");
    warning.hidden = !(smallest < 6);
    if (smallest < 6) {
      warning.textContent = `Some text prints at ${smallest.toFixed(1)}pt, which is hard to read. Try a larger label or turn off a line or two.`;
    }

    scalePreview();
    const count = `${items.length} label${items.length === 1 ? "" : "s"}`;
    const sheets = p.roll ? "" : ` on ${pages} sheet${pages === 1 ? "" : "s"}`;
    $("summary").textContent = items.length ? `${count}${sheets} · ${p.name}` : "Nothing to print yet.";
    $("print-btn").disabled = !items.length;
  }

  // Shrink (or enlarge small roll labels) for the screen. Print ignores this.
  function scalePreview() {
    const box = $("sheets");
    const avail = box.clientWidth;
    for (const frame of box.querySelectorAll(".sheet-frame")) {
      const sheet = frame.firstChild;
      const wPx = sheet.offsetWidth, hPx = sheet.offsetHeight;
      const scale = Math.min(preset().roll ? 2.5 : 1, avail / wPx);
      sheet.style.transform = `scale(${scale})`;
      frame.style.width = wPx * scale + "px";
      frame.style.height = hPx * scale + "px";
    }
  }

  function update() {
    readControls();
    syncVisibility();
    save();
    render();
  }

  // ---------- start ----------

  function init() {
    load();
    fillControls();
    syncVisibility();

    $("label-form").addEventListener("input", (e) => {
      if (e.target.closest("#card-list")) return;
      if (e.target.id === "card-search" || e.target.id === "card-status") {
        readControls();
        save();
        renderPicker();
        return;
      }
      update();
    });
    $("label-form").addEventListener("change", (e) => {
      if (e.target.closest("#card-list")) {
        const set = new Set(state.selected);
        if (e.target.checked) set.add(e.target.value); else set.delete(e.target.value);
        state.selected = [...set];
        save();
        $("pick-count").textContent = `${state.selected.length} selected · ${JSON.parse($("card-list").dataset.shown || "[]").length} shown`;
        render();
      }
    });
    $("label-form").addEventListener("submit", (e) => e.preventDefault());
    $("select-shown").addEventListener("click", () => {
      const shown = JSON.parse($("card-list").dataset.shown || "[]");
      state.selected = [...new Set([...state.selected, ...shown])];
      save();
      renderPicker();
      render();
    });
    $("clear-selection").addEventListener("click", () => {
      state.selected = [];
      save();
      renderPicker();
      render();
    });
    $("print-btn").addEventListener("click", () => window.print());

    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(scalePreview, 100);
    });

    loadJSON("data/inventory.json")
      .then((data) => {
        cards = data.cards || [];
        const known = new Set(cards.map((c) => c.id));
        state.selected = state.selected.filter((id) => known.has(id));
        renderPicker();
        render();
        // Re-fit once web fonts arrive; text widths change.
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(render);
      })
      .catch((err) => {
        $("pick-count").textContent = err.message;
        render();
      });
  }

  init();
})();
