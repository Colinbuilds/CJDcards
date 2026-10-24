#!/usr/bin/env python3
"""Check that the public storefront can't leak private numbers.

Run after the build:  python3 build/check_public.py

Fails (exit 1) if:
  * data/storefront.json has any field besides the public ones
  * a storefront card's price isn't that card's own asking price
  * any raw market, cost, PSA 9, PSA 10 or sold value appears in the storefront
    files (storefront.html, assets/common.js, assets/storefront.js, data/storefront.json)
  * the storefront files mention market / cost / PSA / profit / inventory.json

For the rendered page, also run tests/storefront-render-check.mjs (needs Playwright).
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_FIELDS = {"player", "setCard", "copy", "copies", "ask", "top"}
PRIVATE_FIELDS = ["market", "cost", "psa9", "psa10", "soldFor"]
STOREFRONT_FILES = ["storefront.html", "assets/common.js", "assets/storefront.js", "data/storefront.json"]
BANNED_WORDS = re.compile(r"market|cost|psa|profit|inventory\.json|soldFor", re.I)


def number_forms(v):
    """Ways a private value could be written: 24.5 -> 24.50, 24.5 ; 3.0 -> 3.00."""
    forms = {f"{v:.2f}"}
    short = f"{v:.2f}".rstrip("0").rstrip(".")
    if "." in short:
        forms.add(short)
    return forms


def main():
    inventory = json.loads((ROOT / "data/inventory.json").read_text(encoding="utf-8"))["cards"]
    storefront = json.loads((ROOT / "data/storefront.json").read_text(encoding="utf-8"))["cards"]
    problems = []

    # 1. Only public fields, and every price is a real ask.
    asks = {}
    for c in inventory:
        if c.get("ask") is not None:
            asks.setdefault((c["player"], c["setCard"], c["copy"]), c["ask"])
    for i, card in enumerate(storefront):
        extra = set(card) - PUBLIC_FIELDS
        if extra:
            problems.append(f"storefront.json card {i} has non-public fields: {sorted(extra)}")
        if asks.get((card.get("player"), card.get("setCard"), card.get("copy"))) != card.get("ask"):
            problems.append(f"storefront.json card {i} price doesn't match its list price")

    # 2. Private values: search the storefront files for each one.
    public_asks = {f"{c['ask']:.2f}" for c in storefront}
    private = {}
    for c in inventory:
        for field in PRIVATE_FIELDS:
            v = c.get(field)
            if isinstance(v, (int, float)):
                for form in number_forms(v):
                    private.setdefault(form, set()).add(field)
    texts = {name: (ROOT / name).read_text(encoding="utf-8") for name in STOREFRONT_FILES}
    coincidences = set()
    for form, fields in sorted(private.items()):
        pattern = re.compile(r"(?<![\d.])" + re.escape(form) + r"(?![\d])")
        for name, text in texts.items():
            if name == "data/storefront.json":
                continue  # its numbers are checked structurally above
            if pattern.search(text):
                problems.append(f"{name} contains {form} (a {'/'.join(sorted(fields))} value)")
        if f"{float(form):.2f}" in public_asks:
            coincidences.add(f"{float(form):.2f}")

    # 3. No private wording or links to the full inventory.
    for name, text in texts.items():
        if name == "data/storefront.json":
            text = " ".join(f"{c['player']} {c['setCard']}" for c in storefront)
            keys = {k for c in storefront for k in c}
            if keys - PUBLIC_FIELDS:
                problems.append(f"{name} has keys {sorted(keys - PUBLIC_FIELDS)}")
            continue
        for m in BANNED_WORDS.finditer(text):
            problems.append(f"{name} mentions '{m.group(0)}'")

    print(f"Checked {len(storefront)} storefront cards against {len(private)} private values "
          f"from {len(inventory)} inventory rows.")
    if coincidences:
        print("Note: these amounts are some card's own asking price and also happen to equal a "
              f"private value on some row (not a leak): {', '.join(sorted(coincidences, key=float))}")
    if problems:
        print("FAIL")
        for p in problems:
            print("  -", p)
        sys.exit(1)
    print("PASS: no private values or fields in the storefront files.")


if __name__ == "__main__":
    main()
