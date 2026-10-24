/* Tracker: sales, profit and per-copy status. Reads data/inventory.json and keeps
   your changes (statuses + sales) in localStorage in this browser only. */
(function () {
  "use strict";
  const { money, copyLabel, loadJSON, el, showError } = window.Shop;

  const STORAGE_KEY = "cardTracker.v1";
  const STATUSES = ["Available", "Listed", "Sold", "Pulled", "Graded"];
  const PLATFORMS = {
    collx: { label: "CollX", rate: 0.08, fixed: 0 },
    whatnot: { label: "Whatnot", rate: 0.109, fixed: 0.3 },
    ebay: { label: "eBay", rate: 0.136, fixed: 0 },
    other: { label: "Other", rate: 0, fixed: 0 },
  };
  const DEFAULT_COST = 0.5;

  const $ = (id) => document.getElementById(id);
  const form = {
    card: $("sale-card"), platform: $("sale-platform"), price: $("sale-price"), cost: $("sale-cost"),
    postage: $("sale-postage"), packaging: $("sale-packaging"), fixed: $("sale-fixed"),
  };

  let cards = [];
  let byId = new Map();
  // state = { statuses: { [cardId]: status }, sales: [ ...sale ] }
  let state = { statuses: {}, sales: [] };

  // ---------- storage ----------

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      state.statuses = parsed && typeof parsed.statuses === "object" && parsed.statuses ? parsed.statuses : {};
      state.sales = Array.isArray(parsed && parsed.sales) ? parsed.sales : [];
    } catch (err) {
      warnStorage("Saved tracker data couldn't be read in this browser, so the tracker started empty.");
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      warnStorage("Changes can't be saved in this browser (storage is blocked or full, or this is a private window). They will be lost when you close the page.");
      return false;
    }
  }

  function warnStorage(message) {
    const box = $("storage-warning");
    box.textContent = message;
    box.hidden = false;
  }

  // ---------- helpers ----------

  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const num = (input) => {
    const n = parseFloat(input.value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  function statusOf(card) {
    return state.statuses[card.id] || card.status || "Available";
  }

  function cardName(card) {
    const copy = copyLabel(card);
    return `${card.player || "Unidentified"} · ${card.setCard || "Unknown set"}${copy ? ` (${copy})` : ""}`;
  }

  function calc() {
    const platform = PLATFORMS[form.platform.value] || PLATFORMS.other;
    const sale = round2(num(form.price));
    const fixed = round2(num(form.fixed));
    const fees = round2(sale * platform.rate + fixed);
    const costs = round2(num(form.cost) + num(form.postage) + num(form.packaging));
    return { platform, sale, fixed, fees, costs, net: round2(sale - fees - costs) };
  }

  function signed(el, n) {
    el.textContent = money(n);
    el.classList.toggle("pos", n > 0);
    el.classList.toggle("neg", n < 0);
  }

  // ---------- rendering ----------

  function renderTiles() {
    let inInventory = 0, sold = 0, atAsk = 0;
    for (const card of cards) {
      if (statusOf(card) === "Sold") {
        sold++;
      } else {
        inInventory++;
        atAsk += card.ask || 0;
      }
    }
    const profit = state.sales.reduce((sum, s) => sum + (Number(s.net) || 0), 0);
    $("tile-inventory").textContent = inInventory;
    $("tile-sold").textContent = sold;
    $("tile-sold-sub").textContent = `${state.sales.length} recorded sale${state.sales.length === 1 ? "" : "s"}`;
    signed($("tile-profit"), round2(profit));
    $("tile-ask").textContent = money(atAsk);
  }

  function renderCardOptions() {
    const keep = form.card.value;
    const unsold = cards
      .filter((c) => statusOf(c) !== "Sold")
      .sort((a, b) => (!a.player - !b.player) || (a.player || "").localeCompare(b.player || "") || a.setCard.localeCompare(b.setCard) || a.copy - b.copy);
    const options = unsold.map((c) =>
      el("option", { value: c.id, text: `${cardName(c)}${c.ask != null ? ` · ask ${money(c.ask)}` : ""}` }));
    form.card.replaceChildren(el("option", { value: "", text: unsold.length ? "Choose a card…" : "No unsold cards" }), ...options);
    if (keep && unsold.some((c) => c.id === keep)) form.card.value = keep;
  }

  function renderSales() {
    const body = $("sales-body");
    if (!state.sales.length) {
      body.replaceChildren(el("tr", {}, el("td", { colspan: "8", class: "muted", text: "No sales recorded yet." })));
      return;
    }
    const rows = [...state.sales]
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0))
      .map((s) => {
        const netCell = el("td", { class: "num" });
        signed(netCell, Number(s.net) || 0);
        const del = el("button", {
          type: "button", class: "btn btn-small btn-danger", "data-sale": s.id,
          "aria-label": `Delete sale of ${s.cardName}`, text: "Delete",
        });
        return el("tr", {},
          el("td", { text: s.date }),
          el("td", { text: s.cardName }),
          el("td", {}, s.platformLabel, el("div", { class: "muted", text: `${round2(s.rate * 100)}% + ${money(s.fixed)}` })),
          el("td", { class: "num", text: money(s.sale) }),
          el("td", { class: "num", text: money(s.fees) }),
          el("td", { class: "num", text: money(s.costs) }),
          netCell,
          el("td", {}, del));
      });
    body.replaceChildren(...rows);
  }

  function renderInventory() {
    const body = $("inventory-body");
    const terms = $("inv-search").value.toLowerCase().split(/\s+/).filter(Boolean);
    const want = $("inv-status").value;
    const shown = cards.filter((c) => {
      if (want && statusOf(c) !== want) return false;
      const hay = `${c.player} ${c.setCard} ${c.number} ${copyLabel(c)}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    const rows = shown.map((c) => {
      const status = statusOf(c);
      const select = el("select", { "data-card": c.id, "aria-label": `Status for ${cardName(c)}` },
        ...STATUSES.concat(STATUSES.includes(status) ? [] : [status]).map((s) =>
          el("option", { value: s, text: s, selected: s === status })));
      return el("tr", { class: status === "Sold" ? "is-sold" : null },
        el("td", {}, c.player || "Unidentified", el("div", { class: "muted", text: c.setCard || "Unknown set" })),
        el("td", { text: c.copies > 1 ? `${c.copy} of ${c.copies}` : "—" }),
        el("td", { class: "num", text: c.ask != null ? money(c.ask) : "—" }),
        el("td", { class: "num", text: c.market != null ? money(c.market) : "—" }),
        el("td", { class: "num", text: c.cost != null ? money(c.cost) : "—" }),
        el("td", {}, select));
    });
    if (!rows.length) rows.push(el("tr", {}, el("td", { colspan: "6", class: "muted", text: "No cards match." })));
    body.replaceChildren(...rows);
    $("inv-count").textContent = `Showing ${shown.length} of ${cards.length} copies`;
  }

  function updatePreview() {
    const r = calc();
    $("pv-sale").textContent = money(r.sale);
    $("pv-fees").textContent = money(r.fees);
    $("pv-costs").textContent = money(r.costs);
    signed($("pv-net"), r.net);
  }

  function renderAll() {
    renderTiles();
    renderCardOptions();
    renderSales();
    renderInventory();
    updatePreview();
  }

  // ---------- actions ----------

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function onCardChange() {
    const card = byId.get(form.card.value);
    if (!card) return;
    if (card.ask != null) form.price.value = card.ask.toFixed(2);
    form.cost.value = (card.cost != null ? card.cost : DEFAULT_COST).toFixed(2);
    updatePreview();
  }

  function onPlatformChange() {
    form.fixed.value = (PLATFORMS[form.platform.value] || PLATFORMS.other).fixed.toFixed(2);
    updatePreview();
  }

  function onSubmit(event) {
    event.preventDefault();
    const status = $("form-status");
    const card = byId.get(form.card.value);
    if (!card) {
      status.textContent = "Choose a card first.";
      form.card.focus();
      return;
    }
    if (!(parseFloat(form.price.value) > 0)) {
      status.textContent = "Enter the sale price.";
      form.price.focus();
      return;
    }
    const r = calc();
    state.sales.push({
      id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
      date: todayISO(),
      cardId: card.id,
      cardName: cardName(card),
      platform: form.platform.value,
      platformLabel: r.platform.label,
      rate: r.platform.rate,
      fixed: r.fixed,
      sale: r.sale,
      cost: round2(num(form.cost)),
      postage: round2(num(form.postage)),
      packaging: round2(num(form.packaging)),
      fees: r.fees,
      costs: r.costs,
      net: r.net,
      prevStatus: statusOf(card),
    });
    state.statuses[card.id] = "Sold";
    const saved = saveState();
    form.card.value = "";
    form.price.value = "";
    renderAll();
    status.textContent = `Recorded: ${cardName(card)} for ${money(r.sale)}, net ${money(r.net)}.${saved ? "" : " (Not saved in this browser.)"}`;
    form.card.focus();
  }

  function onDeleteSale(event) {
    const btn = event.target.closest("button[data-sale]");
    if (!btn) return;
    const sale = state.sales.find((s) => s.id === btn.dataset.sale);
    if (!sale || !confirm(`Delete the sale of ${sale.cardName}?`)) return;
    state.sales = state.sales.filter((s) => s.id !== sale.id);
    const card = byId.get(sale.cardId);
    if (card && statusOf(card) === "Sold") {
      setStatus(card, sale.prevStatus && sale.prevStatus !== "Sold" ? sale.prevStatus : "Available");
    }
    saveState();
    renderAll();
    $("form-status").textContent = `Deleted the sale of ${sale.cardName}.`;
  }

  function setStatus(card, status) {
    if (status === card.status) delete state.statuses[card.id];
    else state.statuses[card.id] = status;
  }

  function onStatusChange(event) {
    const select = event.target.closest("select[data-card]");
    if (!select) return;
    const card = byId.get(select.dataset.card);
    if (!card) return;
    setStatus(card, select.value);
    saveState();
    renderTiles();
    renderCardOptions();
    select.closest("tr").classList.toggle("is-sold", select.value === "Sold");
    // Re-render only if the filter would now hide this row; keeps keyboard focus otherwise.
    if ($("inv-status").value && $("inv-status").value !== select.value) renderInventory();
  }

  // ---------- start ----------

  function init() {
    for (const [key, p] of Object.entries(PLATFORMS)) {
      form.platform.append(el("option", { value: key, text: `${p.label} (${round2(p.rate * 100)}%)` }));
    }
    for (const s of STATUSES) $("inv-status").append(el("option", { value: s, text: s }));

    form.card.addEventListener("change", onCardChange);
    form.platform.addEventListener("change", onPlatformChange);
    for (const input of [form.price, form.cost, form.postage, form.packaging, form.fixed]) {
      input.addEventListener("input", updatePreview);
    }
    $("sale-form").addEventListener("submit", onSubmit);
    $("sales-body").addEventListener("click", onDeleteSale);
    $("inventory-body").addEventListener("change", onStatusChange);
    $("inv-search").addEventListener("input", renderInventory);
    $("inv-status").addEventListener("change", renderInventory);

    loadState();
    loadJSON("data/inventory.json")
      .then((data) => {
        cards = data.cards || [];
        byId = new Map(cards.map((c) => [c.id, c]));
        renderAll();
      })
      .catch((err) => showError($("main").querySelector(".tiles"), err.message));
  }

  init();
})();
