/* Shared helpers for storefront.js and tracker.js. Holds no card data. */
(function () {
  "use strict";

  const moneyFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

  function money(n) {
    return moneyFormat.format(Number(n) || 0);
  }

  function copyLabel(card) {
    return card.copies > 1 ? `Copy ${card.copy} of ${card.copies}` : "";
  }

  async function loadJSON(url) {
    let res;
    try {
      res = await fetch(url, { cache: "no-cache" });
    } catch (err) {
      if (location.protocol === "file:") {
        throw new Error("This page has to be served by a web server to load its data. " +
          "Run \"python3 -m http.server\" in the site folder and open http://localhost:8000 (see README).");
      }
      throw new Error(`Could not load ${url}. Check your connection and try again.`);
    }
    if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status}). Did you run the build?`);
    return res.json();
  }

  // Element helper: el("p", { class: "x", text: "hi" }, child1, child2)
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "text") node.textContent = value;
      else if (key === "class") node.className = value;
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children) {
      if (child !== null && child !== undefined && child !== "") {
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
      }
    }
    return node;
  }

  // Puts the message just before `anchor` (an element that can't hold a <p> itself).
  function showError(anchor, message) {
    anchor.before(el("p", { class: "load-error", role: "alert", text: message }));
  }

  window.Shop = { money, copyLabel, loadJSON, el, showError };
})();
