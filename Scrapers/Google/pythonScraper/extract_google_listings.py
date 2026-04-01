from __future__ import annotations

import argparse
import csv
import html
import json
import re
import urllib.parse
from pathlib import Path

FIELDNAMES = [
    "item_name",
    "item_price",
    "item_gender",
    "img_url",
    "web_listing_url",
]

GKQHVE_NAME_PATTERN = re.compile(
    r'<div class="gkQHve[^"]*"[^>]*>(?P<name>.*?)</div>',
    re.IGNORECASE | re.DOTALL,
)

PRICE_TOKEN_PATTERN = re.compile(r"\$[0-9][0-9,]*(?:\.[0-9]{2})?")

ENCRYPTED_IMAGE_PATTERN = re.compile(
    r'https://encrypted-tbn\d\.gstatic\.com/shopping\?q=tbn:[^"\s<]+',
    re.IGNORECASE,
)

DIRECT_ANCHOR_PATTERN = re.compile(
    r'<a(?P<attrs>[^>]*class="[^"]*(?:plantl|tkXAec)[^"]*"[^>]*)>',
    re.IGNORECASE | re.DOTALL,
)

HREF_PATTERN = re.compile(r'href="(?P<url>https?://[^"]+)"', re.IGNORECASE)

DIRECT_NAME_PATTERNS = [
    re.compile(
        r'<div class="r4awE[^"]*"[^>]*>\s*<div>(?P<name>.*?)</div>',
        re.IGNORECASE | re.DOTALL,
    ),
    re.compile(
        r'<div class="gkQHve[^"]*"[^>]*>(?P<name>.*?)</div>',
        re.IGNORECASE | re.DOTALL,
    ),
    re.compile(
        r'aria-label="\s*for\s*(?P<name>.*?)\s*from',
        re.IGNORECASE | re.DOTALL,
    ),
]


def decode_embedded_markup(raw_html: str) -> str:
    decoded = re.sub(r"\\x([0-9a-fA-F]{2})", lambda m: chr(int(m.group(1), 16)), raw_html)
    decoded = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), decoded)
    decoded = decoded.replace("\\/", "/")
    decoded = decoded.replace('\\"', '"').replace("\\'", "'")
    return decoded


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value or "")).strip()


def clean_url(value: str) -> str:
    return (value or "").strip().replace("&amp;", "&")


def normalize_name(item_name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", item_name.casefold())


def tokenize_item_name(item_name: str) -> tuple[str, set[str]]:
    stop_words = {
        "men",
        "mens",
        "women",
        "womens",
        "woman",
        "size",
        "regular",
        "tall",
        "short",
        "fit",
        "classic",
        "slim",
        "baggy",
        "wide",
        "straight",
        "rise",
        "small",
        "medium",
        "large",
        "for",
        "from",
        "the",
        "and",
        "with",
    }

    normalized = item_name.lower().replace("men's", "mens").replace("women's", "womens")
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    words = normalized.split()
    brand = words[0] if words else ""
    tokens = {
        word
        for word in words
        if len(word) >= 3 and word not in stop_words and not any(ch.isdigit() for ch in word)
    }
    return brand, tokens


def looks_like_product_name(item_name: str) -> bool:
    name = clean_text(item_name)
    if len(name) < 3:
        return False
    if not re.search(r"[A-Za-z]", name):
        return False
    disallowed = ["var(", "@media", "{", "}", "font-size", "line-height"]
    lowered = name.casefold()
    return not any(token in lowered for token in disallowed)


def is_external_non_google_url(url: str) -> bool:
    lowered = url.casefold()
    if not lowered.startswith(("http://", "https://")):
        return False
    return not any(
        domain in lowered
        for domain in [
            "google.com",
            "gstatic.com",
            "googleusercontent.com",
            "googleadservices.com",
            "doubleclick.net",
        ]
    )


def infer_gender(item_name: str) -> str:
    lowered = item_name.lower()
    if any(token in lowered for token in ["women", "women's", "womens", "lady", "ladies", "female", "girl", "girls"]):
        return "women"
    if any(token in lowered for token in ["men", "men's", "mens", "male", "boy", "boys"]):
        return "men"
    if "unisex" in lowered:
        return "unisex"
    return "unknown"


def build_google_listing_url(item_name: str) -> str:
    query = urllib.parse.quote_plus(item_name)
    return f"https://www.google.com/search?udm=28&q={query}"


def build_record(item_name: str, item_price: str, img_url: str, web_listing_url: str) -> dict[str, str]:
    clean_name = clean_text(item_name)
    return {
        "item_name": clean_name,
        "item_price": clean_text(item_price),
        "item_gender": infer_gender(clean_name),
        "img_url": clean_url(img_url),
        "web_listing_url": clean_url(web_listing_url),
    }


def record_quality_score(record: dict[str, str]) -> int:
    score = 0
    if record["item_price"]:
        score += 2
    if record["img_url"]:
        score += 1
    if record["web_listing_url"]:
        score += 1
    if is_external_non_google_url(record["web_listing_url"]):
        score += 4
    return score


def add_or_update_record_by_name(records_by_name: dict[str, dict[str, str]], record: dict[str, str]) -> None:
    key = normalize_name(record["item_name"])
    if not key:
        return

    existing = records_by_name.get(key)
    if existing is None or record_quality_score(record) > record_quality_score(existing):
        records_by_name[key] = record


def find_best_url_for_item(
    item_name: str,
    item_price: str,
    direct_records: list[dict[str, str]],
) -> str:
    item_brand, item_tokens = tokenize_item_name(item_name)
    normalized_item = normalize_name(item_name)

    for candidate in direct_records:
        candidate_name = candidate.get("item_name", "")
        candidate_url = candidate.get("web_listing_url", "")
        if not candidate_name or not candidate_url:
            continue

        normalized_candidate = normalize_name(candidate_name)
        if normalized_item and normalized_candidate and (
            normalized_item in normalized_candidate or normalized_candidate in normalized_item
        ):
            return candidate_url

        candidate_brand, candidate_tokens = tokenize_item_name(candidate_name)
        shared_tokens = item_tokens & candidate_tokens
        brands_match = bool(item_brand and candidate_brand and item_brand == candidate_brand)

        if brands_match and shared_tokens:
            return candidate_url

        if item_price and candidate.get("item_price", "") == item_price and len(shared_tokens) >= 2:
            return candidate_url

    return ""


def extract_direct_records(decoded_html: str) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []

    for match in DIRECT_ANCHOR_PATTERN.finditer(decoded_html):
        attrs = match.group("attrs")
        href_match = HREF_PATTERN.search(attrs)
        if not href_match:
            continue

        href = clean_url(href_match.group("url"))
        if not is_external_non_google_url(href):
            continue

        card_start = decoded_html.rfind('<div class="mnr-c pla-unit"', 0, match.start())
        card_end = decoded_html.find('<div class="mnr-c pla-unit"', match.end())
        if card_start == -1:
            card_start = max(0, match.start() - 1200)
        if card_end == -1:
            card_end = min(len(decoded_html), match.end() + 6000)
        context = decoded_html[card_start:card_end]

        item_name = ""
        for pattern in DIRECT_NAME_PATTERNS:
            scope = attrs if "aria-label" in pattern.pattern else context
            found = pattern.search(scope)
            if found:
                candidate = clean_text(found.group("name"))
                if looks_like_product_name(candidate):
                    item_name = candidate
                    break

        if not item_name:
            continue

        price_match = PRICE_TOKEN_PATTERN.search(context)
        img_match = ENCRYPTED_IMAGE_PATTERN.search(context)

        records.append(
            build_record(
                item_name=item_name,
                item_price=price_match.group(0) if price_match else "",
                img_url=img_match.group(0) if img_match else "",
                web_listing_url=href,
            )
        )

    return records


def find_context_external_url(decoded_html: str, item_start: int, item_end: int) -> str:
    context_start = max(0, item_start - 3000)
    context_end = min(len(decoded_html), item_end + 9000)
    context = decoded_html[context_start:context_end]

    # Prefer explicit merchant anchors when they are present nearby.
    for anchor_match in DIRECT_ANCHOR_PATTERN.finditer(context):
        attrs = anchor_match.group("attrs")
        href_match = HREF_PATTERN.search(attrs)
        if not href_match:
            continue

        url = clean_url(href_match.group("url"))
        if is_external_non_google_url(url):
            return url

    best_url = ""
    best_score: int | None = None

    # Fall back to the nearest external href in the local product context.
    for href_match in HREF_PATTERN.finditer(context):
        url = clean_url(href_match.group("url"))
        if not is_external_non_google_url(url):
            continue

        absolute_pos = context_start + href_match.start()
        if absolute_pos >= item_end:
            score = absolute_pos - item_end
        else:
            score = (item_end - absolute_pos) + 1200

        if best_score is None or score < best_score:
            best_score = score
            best_url = url

    return best_url


def extract_listings(decoded_html: str) -> list[dict[str, str]]:
    direct_records = extract_direct_records(decoded_html)
    direct_url_by_name = {
        normalize_name(record["item_name"]): record["web_listing_url"] for record in direct_records
    }

    records_by_name: dict[str, dict[str, str]] = {}

    for match in GKQHVE_NAME_PATTERN.finditer(decoded_html):
        item_name = clean_text(match.group("name"))
        if not looks_like_product_name(item_name):
            continue

        before = decoded_html[max(0, match.start() - 2600) : match.start()]
        after = decoded_html[match.end() : match.end() + 2600]

        prices_after = PRICE_TOKEN_PATTERN.findall(after)
        prices_before = PRICE_TOKEN_PATTERN.findall(before)
        item_price = prices_after[0] if prices_after else (prices_before[-1] if prices_before else "")

        images_before = ENCRYPTED_IMAGE_PATTERN.findall(before)
        images_after = ENCRYPTED_IMAGE_PATTERN.findall(after)
        img_url = images_before[-1] if images_before else (images_after[0] if images_after else "")

        direct_url = direct_url_by_name.get(normalize_name(item_name), "")
        fuzzy_url = find_best_url_for_item(item_name, item_price, direct_records)
        context_url = ""
        if not direct_url and not fuzzy_url:
            context_url = find_context_external_url(decoded_html, match.start(), match.end())

        web_listing_url = direct_url or fuzzy_url or context_url or build_google_listing_url(item_name)

        add_or_update_record_by_name(
            records_by_name,
            build_record(
                item_name=item_name,
                item_price=item_price,
                img_url=img_url,
                web_listing_url=web_listing_url,
            ),
        )

    for record in direct_records:
        add_or_update_record_by_name(records_by_name, record)

    return sorted(records_by_name.values(), key=lambda item: item["item_name"].lower())


def write_csv(rows: list[dict[str, str]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as fp:
        writer = csv.DictWriter(fp, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)


def write_json(rows: list[dict[str, str]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as fp:
        json.dump(rows, fp, ensure_ascii=False, indent=2)


def output_name_for_input(input_html: Path, input_root: Path) -> str:
    relative_no_suffix = input_html.relative_to(input_root).with_suffix("")
    return "_".join(relative_no_suffix.parts)


def process_html_file(
    input_html: Path,
    input_root: Path,
    output_csv_dir: Path,
    output_json_dir: Path,
    default_external_url: str,
) -> tuple[int, Path, Path, str]:
    raw_html = input_html.read_text(encoding="utf-8", errors="ignore")
    decoded_html = decode_embedded_markup(raw_html)
    rows = extract_listings(decoded_html)

    page_external_url = next(
        (row["web_listing_url"] for row in rows if is_external_non_google_url(row["web_listing_url"])),
        "",
    )
    selected_external_url = page_external_url or default_external_url

    if selected_external_url:
        for row in rows:
            if not is_external_non_google_url(row["web_listing_url"]):
                row["web_listing_url"] = selected_external_url

    base_name = output_name_for_input(input_html, input_root)
    csv_path = output_csv_dir / f"{base_name}_listings.csv"
    json_path = output_json_dir / f"{base_name}_listings.json"

    write_csv(rows, csv_path)
    write_json(rows, json_path)

    return len(rows), csv_path, json_path, page_external_url


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract product listings from saved Google Shopping HTML snapshots.",
    )
    parser.add_argument(
        "--input-root",
        type=Path,
        default=Path("shoppingHTML"),
        help="Root folder that contains saved shopping HTML files.",
    )
    parser.add_argument(
        "--csv-out",
        type=Path,
        default=Path("shoppingListingCSV"),
        help="Output directory for extracted CSV files.",
    )
    parser.add_argument(
        "--json-out",
        type=Path,
        default=Path("shoppingListingJSON"),
        help="Output directory for extracted JSON files.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    base_dir = Path(__file__).resolve().parent
    input_root = (base_dir / args.input_root).resolve()
    output_csv_dir = (base_dir / args.csv_out).resolve()
    output_json_dir = (base_dir / args.json_out).resolve()

    html_files = sorted(input_root.rglob("*.html"))
    if not html_files:
        print(f"No HTML files found under: {input_root}")
        return

    total_rows = 0
    global_external_url = ""
    for html_file in html_files:
        row_count, csv_path, json_path, page_external_url = process_html_file(
            input_html=html_file,
            input_root=input_root,
            output_csv_dir=output_csv_dir,
            output_json_dir=output_json_dir,
            default_external_url=global_external_url,
        )

        if not global_external_url and page_external_url:
            global_external_url = page_external_url

        total_rows += row_count
        print(f"{html_file.relative_to(input_root)} -> {row_count} rows")
        print(f"  CSV:  {csv_path}")
        print(f"  JSON: {json_path}")

    print(f"Done. Extracted {total_rows} total rows across {len(html_files)} files.")


if __name__ == "__main__":
    main()
