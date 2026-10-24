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

  function cardItem(card) {
    return el("li", { class: card.top ? "card is-top" : "card" },
      card.top ? el("span", { class: "badge", text: "Top card" }) : null,
      el("h3", { text: card.player }),
      el("p", { class: "set", text: card.setCard }),
      copyLabel(card) ? el("p", { class: "copy", text: copyLabel(card) }) : null,
      el("p", { class: "price" }, money(card.ask), " ", el("small", { text: "Asking" })));
  }

  function render() {
    const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = cards.filter((c) => matches(c, terms)).sort(sorters[sort.value]);
    grid.replaceChildren(...shown.map(cardItem));
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
