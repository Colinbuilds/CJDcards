/* Storefront: searchable grid of cards for sale.
   Reads data/storefront.json, which the build limits to public fields only. */
(function () {
  "use strict";
  const { money, copyLabel, loadJSON, el, showError } = window.Shop;

  const grid = document.getElementById("cards");
  const search = document.getElementById("search");
  const sort = document.getElementById("sort");
  const count = document.getElementById("result-count");
  let cards = [];

  const sorters = {
    "price-desc": (a, b) => b.ask - a.ask || a.player.localeCompare(b.player),
    "price-asc": (a, b) => a.ask - b.ask || a.player.localeCompare(b.player),
    player: (a, b) => a.player.localeCompare(b.player) || a.setCard.localeCompare(b.setCard) || a.copy - b.copy,
  };

  function matches(card, terms) {
    const haystack = `${card.player} ${card.setCard} ${copyLabel(card)}`.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  }

  function photoPlaceholder() {
    return el("span", { class: "photo-placeholder", "aria-hidden": "true", text: "✦" });
  }

  function photoImg(src, alt, eager) {
    const img = el("img", { src, alt, loading: eager ? "eager" : "lazy", decoding: "async", width: "500", height: "700" });
    img.addEventListener("error", () => img.replaceWith(photoPlaceholder()), { once: true });
    return img;
  }

  function cardItem(card, index) {
    const label = `${card.player}, ${card.setCard}${copyLabel(card) ? `, ${copyLabel(card)}` : ""}`;
    const photo = el("button", { type: "button", class: "card-photo", "aria-label": `View photos: ${label}` },
      card.image ? photoImg(card.image, "", index < 4) : photoPlaceholder());
    photo.addEventListener("click", () => openPhotos(card));
    return el("li", { class: card.top ? "card is-top" : "card" },
      photo,
      card.top ? el("span", { class: "badge", text: "Top card" }) : null,
      el("h3", { text: card.player }),
      el("p", { class: "set", text: card.setCard }),
      copyLabel(card) ? el("p", { class: "copy", text: copyLabel(card) }) : null,
      el("p", { class: "price" }, money(card.ask), " ", el("small", { text: "Asking" })));
  }

  // ---------- photo viewer ----------

  const dialog = document.getElementById("photo-dialog");
  const dlg = {
    media: document.getElementById("pd-media"),
    eyebrow: document.getElementById("pd-eyebrow"),
    title: document.getElementById("pd-title"),
    set: document.getElementById("pd-set"),
    copy: document.getElementById("pd-copy"),
    price: document.getElementById("pd-price"),
    sides: document.getElementById("pd-sides"),
    front: document.getElementById("pd-front"),
    back: document.getElementById("pd-back"),
  };
  let current = null;

  function showSide(side) {
    const src = side === "back" ? current.imageBack : current.image;
    const alt = `${side === "back" ? "Back" : "Front"} of ${current.player}, ${current.setCard}`;
    dlg.media.replaceChildren(src ? photoImg(src, alt, true) : photoPlaceholder());
    dlg.front.setAttribute("aria-pressed", String(side !== "back"));
    dlg.back.setAttribute("aria-pressed", String(side === "back"));
  }

  function openPhotos(card) {
    current = card;
    dlg.eyebrow.textContent = card.top ? "Top card" : "The collection";
    dlg.title.textContent = card.player;
    dlg.set.textContent = card.setCard;
    dlg.copy.textContent = copyLabel(card);
    dlg.copy.hidden = !copyLabel(card);
    dlg.price.replaceChildren(money(card.ask), " ", el("small", { text: "Asking" }));
    dlg.sides.hidden = !(card.image && card.imageBack);
    showSide("front");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  if (dialog) {
    dlg.front.addEventListener("click", () => showSide("front"));
    dlg.back.addEventListener("click", () => showSide("back"));
    document.getElementById("pd-close").addEventListener("click", () => dialog.close());
    // Click on the dimmed backdrop closes the viewer.
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
    // Shop links come from assets/common.js.
    for (const id of ["shop-collx", "pd-collx"]) document.getElementById(id).href = window.Shop.links.collx;
    for (const id of ["shop-whatnot", "pd-whatnot"]) document.getElementById(id).href = window.Shop.links.whatnot;
  }

  function render() {
    const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = cards.filter((c) => matches(c, terms)).sort(sorters[sort.value]);
    grid.replaceChildren(...shown.map((c, i) => cardItem(c, i)));
    if (!shown.length) {
      grid.append(el("li", { class: "empty", text: "No cards match your search." }));
    }
    count.textContent = terms.length
      ? `${shown.length} of ${cards.length} cards match “${search.value.trim()}”`
      : `${cards.length} cards for sale`;
  }

  search.addEventListener("input", render);
  sort.addEventListener("change", render);

  loadJSON("data/storefront.json")
    .then((data) => {
      cards = data.cards || [];
      render();
    })
    .catch((err) => showError(grid, err.message));
})();
