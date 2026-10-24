#!/usr/bin/env python3
"""Regenerate the site data from your inventory file.

Usage:
    python3 build/build.py                 # newest .xlsx or .csv in source/
    python3 build/build.py path/to/file    # a specific file

Accepts either:
  * the workbook (.xlsx), reading its "Inventory" tab with the columns
    #, Copy, Player, Year / Set / Card, Raw market (CollX est.),
    List price (ask), Your cost, PSA 9 value, PSA 10 value, Flags, Status
  * a CollX collection export (.csv)

Writes:
  data/inventory.json   every copy, all fields (used by the private tracker)
  data/storefront.json  only public fields of cards for sale (used by the storefront)
  reports/excluded.md   rows left off the storefront, and why

Uses only the Python standard library.
"""
import csv
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATUSES = ["Available", "Listed", "Sold", "Pulled", "Graded"]
TOP_CARD_ASK = 20.0
# The only fields the storefront ever receives.
PUBLIC_FIELDS = ["player", "setCard", "copy", "copies", "ask", "top", "image", "imageBack"]


# ---------- helpers ----------

def money(value):
    """'$1,234.50' / '1.2' / 3 -> float, or None when blank or not a number."""
    if value is None:
        return None
    text = str(value).strip().replace("$", "").replace(",", "")
    if not text:
        return None
    try:
        return round(float(text), 2)
    except ValueError:
        return None


def clean(value):
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return re.sub(r"\s+", " ", str(value)).strip()


def norm_status(value):
    text = clean(value)
    for s in STATUSES:
        if text.lower() == s.lower():
            return s
    return text  # unknown text is kept, and treated as "not Available"


def photo_url(value):
    """Keep only web links (http/https) to photos; anything else is dropped."""
    text = clean(value)
    return text if re.match(r"https?://", text, re.I) else ""


def header_key(text):
    return re.sub(r"[^a-z0-9#]+", " ", clean(text).lower()).strip()


# ---------- .xlsx reading (zip + XML, no libraries) ----------

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}


def col_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def read_xlsx_sheet(path, sheet_name="Inventory"):
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))

        wb = ET.fromstring(z.read("xl/workbook.xml"))
        sheets = wb.findall("m:sheets/m:sheet", NS)
        sheet = next((s for s in sheets if s.get("name", "").strip().lower() == sheet_name.lower()), None)
        if sheet is None:
            names = ", ".join(s.get("name") for s in sheets)
            sys.exit(f'No "{sheet_name}" tab in {path.name}. Tabs found: {names}')
        rid = sheet.get(f"{{{NS['r']}}}id")
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        target = next(r.get("Target") for r in rels.findall("rel:Relationship", NS) if r.get("Id") == rid)
        target = target.lstrip("/")
        sheet_path = target if target.startswith("xl/") else f"xl/{target}"

        rows = []
        for row in ET.fromstring(z.read(sheet_path)).iter(f"{{{NS['m']}}}row"):
            values = {}
            for c in row.findall("m:c", NS):
                kind = c.get("t")
                v = c.find("m:v", NS)
                if kind == "s" and v is not None:
                    val = shared[int(v.text)]
                elif kind == "inlineStr":
                    val = "".join(t.text or "" for t in c.iter(f"{{{NS['m']}}}t"))
                elif v is not None:
                    val = v.text
                    if kind not in ("str", "b", "e"):
                        try:
                            num = float(val)
                            val = int(num) if num.is_integer() else num
                        except ValueError:
                            pass
                else:
                    val = ""
                values[col_index(c.get("r"))] = val
            if values:
                width = max(values) + 1
                rows.append((int(row.get("r")), [values.get(i, "") for i in range(width)]))
        return rows


XLSX_COLUMNS = {
    "number": ["#"],
    "copy": ["copy"],
    "player": ["player"],
    "setCard": ["year set card"],
    "market": ["raw market"],
    "ask": ["list price"],
    "cost": ["your cost"],
    "psa9": ["psa 9"],
    "psa10": ["psa 10"],
    "flags": ["flags"],
    "status": ["status"],
    "image": ["photo", "image", "front image", "front photo"],
    "imageBack": ["back image", "back photo"],
}


def load_xlsx(path):
    rows = read_xlsx_sheet(path)
    header_at = next((i for i, (_, r) in enumerate(rows) if "player" in [header_key(c) for c in r]), None)
    if header_at is None:
        sys.exit('Could not find the header row (a row with a "Player" column) on the Inventory tab.')
    header = [header_key(c) for c in rows[header_at][1]]
    cols = {}
    for field, prefixes in XLSX_COLUMNS.items():
        for i, h in enumerate(header):
            if any(h.startswith(p) for p in prefixes):
                cols[field] = i
                break
    missing = [f for f in ("number", "player", "setCard", "ask", "status") if f not in cols]
    if missing:
        sys.exit(f"Inventory tab is missing columns for: {', '.join(missing)}")

    records = []
    for row_num, r in rows[header_at + 1:]:
        get = lambda f: r[cols[f]] if f in cols and cols[f] < len(r) else ""
        if not any(clean(x) for x in r):
            continue  # blank row
        if not clean(get("number")) and not clean(get("player")):
            continue  # totals/notes row
        records.append({
            "sourceRow": row_num,
            "number": clean(get("number")),
            "copyRaw": clean(get("copy")),
            "player": clean(get("player")),
            "setCard": clean(get("setCard")),
            "market": money(get("market")),
            "ask": money(get("ask")),
            "cost": money(get("cost")),
            "psa9": money(get("psa9")),
            "psa10": money(get("psa10")),
            "soldFor": None,
            "flags": clean(get("flags")),
            "image": photo_url(get("image")),
            "imageBack": photo_url(get("imageBack")),
            "status": norm_status(get("status")),
            "raw": tuple(clean(x) for x in r),
        })
    return records


def load_csv(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        records = []
        for i, r in enumerate(reader, start=2):
            r = {k.strip().lower(): v for k, v in r.items() if k}
            set_name, number = clean(r.get("set")), clean(r.get("number"))
            set_card = f"{set_name} #{number}" if set_name and number else set_name
            sold_for = money(r.get("sold_for_price"))
            status = norm_status(r.get("status")) or ("Sold" if sold_for is not None else "Available")
            records.append({
                "sourceRow": i,
                "id": clean(r.get("collx_id")),
                "number": number,
                "copyRaw": clean(r.get("copy")),
                "player": clean(r.get("name")),
                "setCard": set_card,
                "groupKey": (clean(r.get("name")), clean(r.get("year")), set_name, number),
                "category": clean(r.get("category")),
                "team": clean(r.get("team")),
                "market": money(r.get("market_value")),
                "ask": money(r.get("asking_price")),
                "cost": money(r.get("purchase_price")),
                "psa9": None,
                "psa10": None,
                "soldFor": sold_for,
                "flags": clean(r.get("flags")),
                "image": photo_url(r.get("front_image")),
                "imageBack": photo_url(r.get("back_image")),
                "status": status,
                "raw": tuple(clean(v) for v in r.values()),
            })
    return records


# ---------- copies, exclusions, output ----------

def is_unidentified(rec):
    return (not rec["player"] or not rec["setCard"]
            or "unidentified" in rec["player"].lower() or "unidentified" in rec["setCard"].lower())


def assign_copies(records):
    """Every row is one physical card. Rows sharing a card number (workbook) or the
    same player/year/set/number (CollX export) are copies of the same card."""
    groups = defaultdict(list)
    for rec in records:
        if is_unidentified(rec):
            key = ("row", rec["sourceRow"])  # can't tell what it is; never group it
        else:
            key = rec.get("groupKey") or ("#", rec["number"] or f"row{rec['sourceRow']}")
        groups[key].append(rec)

    for group in groups.values():
        used = set()
        for rec in group:
            n = rec["copyRaw"]
            if n.isdigit() and int(n) not in used:
                rec["copy"] = int(n)
                used.add(int(n))
        next_n = 1
        for rec in group:
            if "copy" not in rec:
                while next_n in used:
                    next_n += 1
                rec["copy"] = next_n
                used.add(next_n)
        for rec in group:
            rec["copies"] = len(group)

    for rec in records:
        if not rec.get("id"):
            rec["id"] = f"{rec['number'] or 'row' + str(rec['sourceRow'])}-c{rec['copy']}"


def find_exact_duplicates(records):
    """Rows with a blank Copy where every field matches exactly."""
    seen = defaultdict(list)
    for rec in records:
        if not rec["copyRaw"]:
            seen[rec["raw"]].append(rec["sourceRow"])
    return [rows for rows in seen.values() if len(rows) > 1]


def exclusion_reason(rec):
    if is_unidentified(rec):
        return "Unidentified card (player or set missing / marked Unidentified)"
    if rec["ask"] is None:
        return "No list price"
    if rec["status"] != "Available":
        return f'Status is "{rec["status"] or "blank"}", not Available'
    return None


def describe(rec):
    copy = f" (Copy {rec['copy']} of {rec['copies']})" if rec["copies"] > 1 else ""
    player = rec["player"] or "—"
    set_card = rec["setCard"] or "—"
    return f"{player} · {set_card}{copy}"


def write_report(path, source, excluded, duplicates):
    lines = [
        "# Rows excluded from the storefront",
        "",
        f"Source: `{source}`  ",
        f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        "",
        "These rows are still in `data/inventory.json` and on the tracker page. "
        "They are only left off the public storefront.",
        "",
    ]
    if excluded:
        lines += ["| Source row | ID | Card # | Card | Reason |", "|---|---|---|---|---|"]
        for rec, reason in excluded:
            card = describe(rec).replace("|", "\\|")
            lines.append(f"| {rec['sourceRow']} | {rec['id']} | {rec['number'] or '—'} | {card} | {reason} |")
    else:
        lines.append("_No rows excluded._")
    lines += ["", "## Possible duplicate entries", ""]
    if duplicates:
        lines.append("These rows have a blank Copy and every field matches exactly. "
                     "All of them are kept for now. Please confirm whether they are separate "
                     "copies (fill in Copy 1, 2, ...) or a double entry (delete one).")
        lines.append("")
        for rows in duplicates:
            lines.append(f"- Source rows {', '.join(map(str, rows))}")
    else:
        lines.append("_None found._")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def pick_source(arg):
    if arg:
        p = Path(arg)
        if not p.exists():
            sys.exit(f"File not found: {p}")
        return p
    candidates = sorted(
        [p for p in (ROOT / "source").glob("*") if p.suffix.lower() in (".xlsx", ".csv") and not p.name.startswith("~$")],
        key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        sys.exit("No .xlsx or .csv file in source/. Put your workbook or CollX export there.")
    return candidates[0]


def main():
    src = pick_source(sys.argv[1] if len(sys.argv) > 1 else None)
    records = load_xlsx(src) if src.suffix.lower() == ".xlsx" else load_csv(src)
    assign_copies(records)
    duplicates = find_exact_duplicates(records)
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        source_label = str(src.resolve().relative_to(ROOT))
    except ValueError:
        source_label = src.name

    full_fields = ["id", "sourceRow", "number", "copy", "copies", "player", "setCard", "category",
                   "flags", "status", "ask", "market", "cost", "psa9", "psa10", "soldFor", "image", "imageBack"]
    cards = [{k: rec.get(k, "") for k in full_fields} for rec in records]

    public, excluded = [], []
    for rec in records:
        reason = exclusion_reason(rec)
        if reason:
            excluded.append((rec, reason))
            continue
        item = {
            "player": rec["player"],
            "setCard": rec["setCard"],
            "copy": rec["copy"],
            "copies": rec["copies"],
            "ask": rec["ask"],
            "top": rec["ask"] >= TOP_CARD_ASK,
            "image": rec.get("image", ""),
            "imageBack": rec.get("imageBack", ""),
        }
        assert list(item) == PUBLIC_FIELDS
        public.append(item)

    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "reports").mkdir(exist_ok=True)
    (ROOT / "data" / "inventory.json").write_text(
        json.dumps({"generated": generated, "source": source_label, "statuses": STATUSES, "cards": cards}, indent=1, ensure_ascii=False) + "\n",
        encoding="utf-8")
    (ROOT / "data" / "storefront.json").write_text(
        json.dumps({"generated": generated, "cards": public}, indent=1, ensure_ascii=False) + "\n",
        encoding="utf-8")
    write_report(ROOT / "reports" / "excluded.md", source_label, excluded, duplicates)

    multi = sum(1 for r in records if r["copies"] > 1)
    with_copy_col = sum(1 for r in records if r["copyRaw"])
    print(f"Read {len(records)} rows from {source_label}")
    print(f"  copies of multi-copy cards: {multi} (Copy column filled on {with_copy_col} rows)")
    print(f"  storefront: {len(public)} cards, excluded: {len(excluded)} (see reports/excluded.md)")
    if duplicates:
        print(f"  WARNING: {len(duplicates)} possible duplicate entr{'y' if len(duplicates) == 1 else 'ies'} kept; see reports/excluded.md")


if __name__ == "__main__":
    main()
