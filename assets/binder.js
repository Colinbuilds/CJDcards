/* The binder: cards from data/storefront.json in 9-pocket pages. Two pages side by side on
   wide screens, one on phones. Tap a card to pull it out of its sleeve. */
(function () {
  "use strict";
  const { money, copyLabel, loadJSON, el, showError, links } = window.Shop;

  const PER_PAGE = 9;
  const LIFT_GROW = 26 / 25;   // card grows slightly as it leaves the sleeve
  const SWIPE_RATIO = 3 / 2;   // a swipe must be this much more sideways than vertical
  const WIDE = window.matchMedia("(min-width: 56rem)");
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");
  const $ = (id) => document.getElementById(id);

  const spread = $("spread");
  const slotLeft = $("slot-left");
  const slotRight = $("slot-right");
  const search = $("binder-search");
  const sort = $("binder-sort");
  const prevBtn = $("prev-page");
  const nextBtn = $("next-page");
  const status = $("page-status");

  let cards = [];
  let shown = [];
  let view = 0;        // index of the first page in view (left page when two are shown)
  let busy = false;    // a page is turning

  const sorters = {
    "price-desc": (a, b) => b.ask - a.ask || a.player.localeCompare(b.player),
    "price-asc": (a, b) => a.ask - b.ask || a.player.localeCompare(b.player),
    player: (a, b) => a.player.localeCompare(b.player) || a.setCard.localeCompare(b.setCard) || a.copy - b.copy,
  };

  const wide = () => WIDE.matches;
  const step = () => (wide() ? 2 : 1);
  const pageCount = () => Math.max(1, Math.ceil(shown.length / PER_PAGE));
  const duration = (ms) => (REDUCED.matches ? 0 : ms);

  function describe(card) {
    return `${card.player}, ${card.setCard}${copyLabel(card) ? `, ${copyLabel(card)}` : ""}, ${money(card.ask)}`;
  }

  // ---------- pages ----------

  function pocket(card, index) {
    if (!card) return el("div", { class: "pocket empty", "aria-hidden": "true" });
    const img = card.image
      ? el("img", { src: card.image, alt: "", decoding: "async", width: "250", height: "350" })
      : el("span", { class: "no-photo", text: "✦" });
    if (card.image) img.addEventListener("error", () => img.replaceWith(el("span", { class: "no-photo", text: "✦" })), { once: true });
    return el("button", { type: "button", class: "pocket", "data-index": index, "aria-label": `${describe(card)}. Pull out card` },
      img,
      card.top ? el("span", { class: "pocket-star", "aria-hidden": "true", text: "✦" }) : null,
      el("span", { class: "pocket-tag", "aria-hidden": "true", text: money(card.ask) }));
  }

  function page(n) {
    if (n < 0 || n >= pageCount()) return el("div", { class: "blank-page" });
    const start = n * PER_PAGE;
    const pockets = [];
    for (let i = start; i < start + PER_PAGE; i++) pockets.push(pocket(shown[i], i));
    const p = el("div", { class: "page", role: "group", "aria-label": `Page ${n + 1} of ${pageCount()}` }, ...pockets,
      el("span", { class: "page-number", "aria-hidden": "true", text: `${n + 1}` }));
    if (!shown.length && n === 0) {
      p.replaceChildren(el("p", { class: "binder-empty", text: "No cards match your search." }));
    }
    return p;
  }

  function render() {
    if (wide()) {
      slotLeft.replaceChildren(page(view));
      slotRight.replaceChildren(page(view + 1));
    } else {
      slotRight.replaceChildren(page(view));
    }
    const last = Math.min(view + step(), pageCount());
    const pages = step() === 2 && last > view + 1 ? `Pages ${view + 1}–${last}` : `Page ${view + 1}`;
    status.textContent = `${pages} of ${pageCount()} · ${shown.length} card${shown.length === 1 ? "" : "s"}`;
    prevBtn.disabled = view <= 0;
    nextBtn.disabled = view + step() >= pageCount();
    preloadAround();
  }

  // Fetch photos for the pages on either side, so they're ready before a page turns.
  const preloaded = new Set();
  function preloadAround() {
    const s = step();
    for (let n = view - s; n < view + 2 * s; n++) {
      for (const card of shown.slice(Math.max(0, n) * PER_PAGE, (n + 1) * PER_PAGE)) {
        if (n < 0 || !card.image || preloaded.has(card.image)) continue;
        preloaded.add(card.image);
        new Image().src = card.image;
      }
    }
  }

  function refilter() {
    const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    shown = cards
      .filter((c) => {
        const hay = `${c.player} ${c.setCard} ${copyLabel(c)}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .sort(sorters[sort.value]);
    view = 0;
    render();
  }

  // ---------- page turns ----------

  function leafOver(slot, front, back) {
    const leaf = el("div", { class: "leaf", inert: true, "aria-hidden": "true" },
      el("div", { class: "leaf-face leaf-front" }, front),
      el("div", { class: "leaf-face leaf-back" }, back));
    Object.assign(leaf.style, {
      left: slot.offsetLeft + "px", top: slot.offsetTop + "px",
      width: slot.offsetWidth + "px", height: slot.offsetHeight + "px",
    });
    spread.append(leaf);
    return leaf;
  }

  function animateLeaf(leaf, origin, from, to) {
    leaf.style.transformOrigin = origin;
    const anim = leaf.animate(
      [{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${to}deg)` }],
      { duration: duration(700), easing: "cubic-bezier(0.45, 0.05, 0.2, 1)", fill: "forwards" });
    leaf.querySelectorAll(".leaf-face").forEach((f) =>
      f.animate([{ "--shade": 0 }, { "--shade": 1, offset: 1 / 2 }, { "--shade": 0 }], { duration: duration(700) }));
    return anim.finished;
  }

  async function turn(dir) {
    if (busy) return;
    const s = step();
    const target = view + dir * s;
    if (target < 0 || target >= pageCount()) return;
    busy = true;
    try {
      if (wide()) {
        if (dir > 0) {
          const leaf = leafOver(slotRight, page(view + 1), page(view + 2));
          slotRight.replaceChildren(page(view + 3));
          await animateLeaf(leaf, "left center", 0, -180);
          view = target;
          slotLeft.replaceChildren(page(view));
          leaf.remove();
        } else {
          const leaf = leafOver(slotLeft, page(view), page(view - 1));
          slotLeft.replaceChildren(page(view - 2));
          await animateLeaf(leaf, "right center", 0, 180);
          view = target;
          slotRight.replaceChildren(page(view + 1));
          leaf.remove();
        }
      } else if (dir > 0) {
        const leaf = leafOver(slotRight, page(view), el("div", { class: "blank-page" }));
        slotRight.replaceChildren(page(target));
        await animateLeaf(leaf, "left center", 0, -180);
        view = target;
        leaf.remove();
      } else {
        const leaf = leafOver(slotRight, page(target), el("div", { class: "blank-page" }));
        await animateLeaf(leaf, "left center", -180, 0);
        view = target;
        slotRight.replaceChildren(page(view));
        leaf.remove();
      }
    } finally {
      busy = false;
      render();
    }
  }

  // ---------- pull a card out ----------

  const dialog = $("pull");
  const pullCard = $("pull-card");
  const inner = $("pull-inner");
  const details = $("pull-details");
  let openPocket = null;
  let closing = false;

  function brandBack() {
    return el("span", { class: "brand-back" }, el("span", { text: "✦" }), el("strong", { text: "CJDcards" }), el("span", { text: "Fine sports cards" }));
  }

  function faceImg(src, alt) {
    const img = el("img", { src, alt });
    img.addEventListener("error", () => img.replaceWith(brandBack()), { once: true });
    return img;
  }

  // Transform that puts the big card exactly over the pocket's card.
  function pocketTransform(pocketEl) {
    const from = (pocketEl.querySelector("img") || pocketEl).getBoundingClientRect();
    const to = pullCard.getBoundingClientRect();
    const scale = from.height / to.height;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    return { dx, dy, scale, lift: from.height * 0.55 };
  }

  function openCard(index, pocketEl) {
    const card = shown[index];
    if (!card || busy) return;
    openPocket = pocketEl;
    inner.classList.remove("flipped");
    $("pull-front").replaceChildren(card.image ? faceImg(card.image, `Front of ${card.player}, ${card.setCard}`) : brandBack());
    $("pull-back").replaceChildren(card.imageBack ? faceImg(card.imageBack, `Back of ${card.player}, ${card.setCard}`) : brandBack());
    $("pull-eyebrow").textContent = card.top ? "Top card" : "From the binder";
    $("pull-title").textContent = card.player;
    $("pull-set").textContent = card.setCard;
    $("pull-copy").textContent = copyLabel(card);
    $("pull-copy").hidden = !copyLabel(card);
    $("pull-price").replaceChildren(money(card.ask), " ", el("small", { text: "Asking" }));

    dialog.showModal();
    pocketEl.classList.add("is-out");
    const t = pocketTransform(pocketEl);
    const at = (x, y, s) => `translate(${x}px, ${y}px) scale(${s})`;
    // Slide up out of the sleeve, then glide to the middle of the screen.
    pullCard.animate([
      { transform: at(t.dx, t.dy, t.scale) },
      { transform: at(t.dx, t.dy - t.lift, t.scale * LIFT_GROW), offset: 0.35 },
      { transform: "none" },
    ], { duration: duration(750), easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    details.animate([{ opacity: 0, transform: "translateY(12px)" }, { opacity: 0, offset: 0.4 }, { opacity: 1, transform: "none" }],
      { duration: duration(750), easing: "ease-out" });
    pullCard.focus();
  }

  async function closeCard() {
    if (!dialog.open || closing) return;
    closing = true;
    const pocketEl = openPocket;
    if (pocketEl && pocketEl.isConnected) {
      inner.classList.remove("flipped");
      const t = pocketTransform(pocketEl);
      const at = (x, y, s) => `translate(${x}px, ${y}px) scale(${s})`;
      details.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration(200), fill: "forwards" });
      await pullCard.animate([
        { transform: "none" },
        { transform: at(t.dx, t.dy - t.lift, t.scale * LIFT_GROW), offset: 0.65 },
        { transform: at(t.dx, t.dy, t.scale) },
      ], { duration: duration(650), easing: "cubic-bezier(0.55, 0, 0.3, 1)" }).finished;
      details.getAnimations().forEach((a) => a.cancel());
    }
    dialog.close();
    if (pocketEl) {
      pocketEl.classList.remove("is-out");
      if (pocketEl.isConnected) pocketEl.focus();
    }
    openPocket = null;
    closing = false;
  }

  // ---------- events ----------

  spread.addEventListener("click", (e) => {
    const p = e.target.closest(".pocket[data-index]");
    if (p) openCard(Number(p.dataset.index), p);
  });
  pullCard.addEventListener("click", () => inner.classList.toggle("flipped"));
  $("pull-close").addEventListener("click", closeCard);
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); closeCard(); });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) closeCard(); });
  $("pull-collx").href = links.collx;
  $("pull-whatnot").href = links.whatnot;

  prevBtn.addEventListener("click", () => turn(-1));
  nextBtn.addEventListener("click", () => turn(1));
  search.addEventListener("input", refilter);
  sort.addEventListener("change", refilter);

  document.addEventListener("keydown", (e) => {
    if (dialog.open || e.target.closest("input, select, textarea")) return;
    if (e.key === "ArrowRight") turn(1);
    else if (e.key === "ArrowLeft") turn(-1);
  });

  let touch = null;
  spread.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    touch = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  spread.addEventListener("touchend", (e) => {
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * SWIPE_RATIO) turn(dx < 0 ? 1 : -1);
  }, { passive: true });

  // Switching between one and two pages: keep the first visible page in view.
  WIDE.addEventListener("change", () => {
    if (wide() && view % 2) view -= 1;
    render();
  });

  loadJSON("data/storefront.json")
    .then((data) => {
      cards = data.cards || [];
      refilter();
    })
    .catch((err) => showError($("binder"), err.message));
})();
