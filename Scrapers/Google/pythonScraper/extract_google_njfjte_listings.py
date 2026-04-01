from __future__ import annotations

import argparse
import csv
import json
import re
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import urlparse

from extract_google_listings import (
    build_google_listing_url,
    clean_text,
    clean_url,
    decode_embedded_markup,
    extract_direct_records,
    find_context_external_url,
    infer_gender,
    is_external_non_google_url,
    normalize_name,
    tokenize_item_name,
)

FIELDNAMES = [
    "item_name",
    "item_price",
    "item_gender",
    "item_img_url",
    "item_web_listing",
]

NJFJTE_PATTERN = re.compile(
    r'<div[^>]*class="[^"]*njFjte[^"]*"[^>]*aria-label="(?P<label>[^"]+)"[^>]*>',
    re.IGNORECASE,
)

GKQHVE_NAME_PATTERN = re.compile(
    r'<div class="gkQHve[^"]*"[^>]*>(?P<name>.*?)</div>',
    re.IGNORECASE | re.DOTALL,
)

PRICE_TOKEN_PATTERN = re.compile(r"\$[0-9][0-9,]*(?:\.[0-9]{2})?")

CURRENT_PRICE_PATTERN = re.compile(
    r"Current Price:\s*(?P<price>\$[0-9][0-9,]*(?:\.[0-9]{2})?)",
    re.IGNORECASE,
)

ENCRYPTED_IMAGE_PATTERN = re.compile(
    r'https://encrypted-tbn\d\.gstatic\.com/shopping\?q=tbn:[^"\s<]+',
    re.IGNORECASE,
)

MERCHANT_LABEL_PATTERN = re.compile(
    r'<span[^>]*class="[^"]*WJMUdc[^"]*rw5ecc[^"]*"[^>]*>(?P<merchant>.*?)</span>',
    re.IGNORECASE | re.DOTALL,
)

NTOF_PATTERN = re.compile(r'data-ntof\s*=\s*"?(?P<count>\d+)"?', re.IGNORECASE)

ROLE_LIST_PATTERN = re.compile(r'<div[^>]*role="list"[^>]*>', re.IGNORECASE)

HREF_PATTERN = re.compile(r'href="(?P<url>https?://[^"]+)"', re.IGNORECASE)
DIV_TAG_PATTERN = re.compile(r"</?div\b", re.IGNORECASE)

MERCHANT_STOP_WORDS = {
    "and",
    "co",
    "com",
    "company",
    "for",
    "from",
    "inc",
    "llc",
    "net",
    "official",
    "org",
    "shop",
    "store",
    "the",
    "www",
}

GENERIC_PRODUCT_TOKENS = {
    "athletic",
    "boot",
    "boots",
    "brief",
    "cargo",
    "cardigan",
    "casual",
    "clothing",
    "coat",
    "cotton",
    "crew",
    "denim",
    "dress",
    "fit",
    "fleece",
    "flannel",
    "fleece",
    "hoodie",
    "jacket",
    "jean",
    "jersey",
    "knit",
    "linen",
    "long",
    "low",
    "mens",
    "mini",
    "pant",
    "pants",
    "performance",
    "polo",
    "pullover",
    "running",
    "shirt",
    "shoes",
    "short",
    "shorts",
    "sleeve",
    "slim",
    "sneaker",
    "sneakers",
    "soft",
    "sweater",
    "tee",
    "top",
    "training",
    "unisex",
    "vneck",
    "wear",
    "womens",
    "workout",
    "high",
    "rise",
    "low",
    "mid",
    "wide",
    "leg",
    "relaxed",
    "straight",
    "tapered",
    "cropped",
    "oversized",
    "classic",
    "everyday",
    "essential",
    "modern",
    "vintage",
    "cargo",
    "pocket",
    "knit",
    "blend",
    "woven",
    "fitted",
    "regular",
    "pull",
    "button",
    "down",
    "longsleeve",
    "shortsleeve",
    "navy",
    "black",
    "white",
    "blue",
    "grey",
    "gray",
    "beige",
    "brown",
    "green",
    "red",
    "pink",
    "small",
    "medium",
    "large",
    "zip",
}


def parse_name_from_aria_label(aria_label: str) -> str:
    prefix = aria_label.split("Current Price:", maxsplit=1)[0]
    for sentence in [part.strip() for part in prefix.split(".") if part.strip()]:
        lowered = sentence.casefold()
        if lowered.startswith("nearby,"):
            continue
        if "% off" in lowered:
            continue
        if lowered.startswith("was $"):
            continue
        return clean_text(sentence)

    return clean_text(prefix)


def find_name_for_card(decoded_html: str, card_start: int, card_end: int, aria_label: str) -> str:
    # Prefer the visible card title text when present; aria-label is fallback.
    after = decoded_html[card_end : card_end + 5000]
    name_match = GKQHVE_NAME_PATTERN.search(after)
    if name_match:
        candidate = clean_text(name_match.group("name"))
        if candidate:
            return candidate

    before = decoded_html[max(0, card_start - 2000) : card_start]
    name_match = GKQHVE_NAME_PATTERN.search(before)
    if name_match:
        candidate = clean_text(name_match.group("name"))
        if candidate:
            return candidate

    return parse_name_from_aria_label(aria_label)


def find_price_for_card(decoded_html: str, card_start: int, card_end: int, aria_label: str) -> str:
    label_match = CURRENT_PRICE_PATTERN.search(aria_label)
    if label_match:
        return clean_text(label_match.group("price"))

    before = decoded_html[max(0, card_start - 2200) : card_start]
    after = decoded_html[card_end : card_end + 2200]
    prices_after = PRICE_TOKEN_PATTERN.findall(after)
    prices_before = PRICE_TOKEN_PATTERN.findall(before)
    if prices_after:
        return clean_text(prices_after[0])
    if prices_before:
        return clean_text(prices_before[-1])
    return ""


def find_image_for_card(decoded_html: str, card_start: int, card_end: int) -> str:
    context_start = max(0, card_start - 4000)
    context_end = min(len(decoded_html), card_end + 5000)
    context = decoded_html[context_start:context_end]

    best_url = ""
    best_score: int | None = None

    for match in ENCRYPTED_IMAGE_PATTERN.finditer(context):
        absolute_pos = context_start + match.start()
        if absolute_pos >= card_end:
            score = absolute_pos - card_end
        else:
            score = (card_start - absolute_pos) + 800

        if best_score is None or score < best_score:
            best_score = score
            best_url = match.group(0)

    return clean_url(best_url)


def merchant_tokens(value: str) -> set[str]:
    normalized = re.sub(r"[^a-z0-9]+", " ", clean_text(value).casefold())
    return {
        token
        for token in normalized.split()
        if len(token) >= 3 and token not in MERCHANT_STOP_WORDS
    }


def informative_name_tokens(value: str) -> set[str]:
    _, tokens = tokenize_item_name(value)
    return {
        token
        for token in tokens
        if token not in GENERIC_PRODUCT_TOKENS
    }


def domain_tokens_from_url(url: str) -> set[str]:
    host = urlparse(clean_url(url)).netloc.casefold()
    host = host.split("@")[-1].split(":")[0]
    parts = re.split(r"[^a-z0-9]+", host)
    return {
        part
        for part in parts
        if len(part) >= 3 and part not in MERCHANT_STOP_WORDS
    }


def find_merchant_hint_for_card(decoded_html: str, card_start: int, card_end: int) -> str:
    after = decoded_html[card_end : card_end + 7000]
    after_match = MERCHANT_LABEL_PATTERN.search(after)
    if after_match:
        merchant = clean_text(after_match.group("merchant"))
        if merchant:
            return merchant

    before = decoded_html[max(0, card_start - 2500) : card_start]
    before_matches = list(MERCHANT_LABEL_PATTERN.finditer(before))
    if before_matches:
        merchant = clean_text(before_matches[-1].group("merchant"))
        if merchant:
            return merchant

    return ""


def find_offer_count_hint_for_card(decoded_html: str, card_start: int, card_end: int) -> int:
    window_start = max(0, card_start - 1500)
    window_end = min(len(decoded_html), card_end + 9000)
    window = decoded_html[window_start:window_end]

    match = NTOF_PATTERN.search(window)
    if not match:
        return 0

    try:
        return int(match.group("count"))
    except ValueError:
        return 0


def choose_best_external_url(urls: list[str], merchant_hint: str) -> str:
    if not urls:
        return ""

    merchant_hint_tokens = merchant_tokens(merchant_hint)
    if merchant_hint_tokens:
        for url in urls:
            if merchant_hint_tokens & domain_tokens_from_url(url):
                return url

    return urls[0]


def find_list_block_end(html_segment: str, list_div_start: int) -> int:
    depth = 0
    for tag_match in DIV_TAG_PATTERN.finditer(html_segment, list_div_start):
        is_closing = tag_match.group(0).startswith("</")
        if not is_closing:
            depth += 1
            continue

        if depth > 0:
            depth -= 1
            if depth == 0:
                return tag_match.start()

    return min(len(html_segment), list_div_start + 14000)


def find_offer_panel_external_url(
    decoded_html: str,
    card_start: int,
    card_end: int,
) -> str:
    window_start = card_end
    window_end = min(len(decoded_html), card_end + 22000)
    window = decoded_html[window_start:window_end]

    # For the corresponding item, use the first external link from div[data-ntof][role="list"].
    for list_match in ROLE_LIST_PATTERN.finditer(window):
        attrs = list_match.group(0)
        if "data-ntof" not in attrs.casefold():
            continue

        list_end = find_list_block_end(window, list_match.start())
        list_segment = window[list_match.end() : list_end]
        for href_match in HREF_PATTERN.finditer(list_segment):
            url = clean_url(href_match.group("url"))
            if is_external_non_google_url(url):
                return url

    return ""


def score_direct_candidate(
    item_name: str,
    item_price: str,
    merchant_hint: str,
    candidate: dict[str, str],
) -> int:
    candidate_name = clean_text(candidate.get("item_name", ""))
    candidate_url = clean_url(candidate.get("web_listing_url", ""))
    if not candidate_name or not is_external_non_google_url(candidate_url):
        return -1

    item_normalized = normalize_name(item_name)
    candidate_normalized = normalize_name(candidate_name)
    if not item_normalized or not candidate_normalized:
        return -1

    item_brand, item_tokens = tokenize_item_name(item_name)
    candidate_brand, candidate_tokens = tokenize_item_name(candidate_name)
    shared_tokens = item_tokens & candidate_tokens
    item_info_tokens = informative_name_tokens(item_name)
    candidate_info_tokens = informative_name_tokens(candidate_name)
    shared_info_tokens = item_info_tokens & candidate_info_tokens

    name_ratio = SequenceMatcher(None, item_normalized, candidate_normalized).ratio()

    merchant_hint_tokens = merchant_tokens(merchant_hint)
    shared_merchant_tokens = merchant_hint_tokens & domain_tokens_from_url(candidate_url)

    brands_match = bool(item_brand and candidate_brand and item_brand == candidate_brand)
    exact_or_contains = bool(
        item_normalized == candidate_normalized
        or item_normalized in candidate_normalized
        or candidate_normalized in item_normalized
    )

    # Guardrail: avoid assigning clearly unrelated products to the same generic listing URL.
    strong_signal = (
        exact_or_contains
        or len(shared_info_tokens) >= 2
        or (brands_match and len(shared_info_tokens) >= 1)
        or (name_ratio >= 0.74 and len(shared_tokens) >= 2)
    )
    if not strong_signal:
        return -1

    score = int(name_ratio * 100)

    if item_normalized == candidate_normalized:
        score += 120
    elif item_normalized in candidate_normalized or candidate_normalized in item_normalized:
        score += 65

    if brands_match:
        score += 25

    score += len(shared_info_tokens) * 28
    score += len(shared_tokens) * 6

    candidate_price = clean_text(candidate.get("item_price", ""))
    if item_price and candidate_price and item_price == candidate_price:
        score += 10 if not shared_info_tokens else 24

    if shared_merchant_tokens:
        score += 18 + (len(shared_merchant_tokens) * 6)

    return score


def find_best_url_for_card(
    item_name: str,
    item_price: str,
    merchant_hint: str,
    offer_count_hint: int,
    direct_records: list[dict[str, str]],
) -> str:
    best_url = ""
    best_score = -1

    for candidate in direct_records:
        score = score_direct_candidate(item_name, item_price, merchant_hint, candidate)
        if score > best_score:
            best_score = score
            best_url = clean_url(candidate.get("web_listing_url", ""))

    if not best_url:
        return ""

    threshold = 88 if offer_count_hint > 0 else 96
    return best_url if best_score >= threshold else ""


def context_url_matches_merchant(context_url: str, merchant_hint: str, offer_count_hint: int) -> bool:
    if not context_url:
        return False

    merchant_hint_tokens = merchant_tokens(merchant_hint)
    if not merchant_hint_tokens:
        # Without a merchant hint, only trust context links when we have an offer-count hint.
        return offer_count_hint > 0

    return bool(merchant_hint_tokens & domain_tokens_from_url(context_url))


def names_look_like_same_item(name_a: str, name_b: str) -> bool:
    normalized_a = normalize_name(name_a)
    normalized_b = normalize_name(name_b)
    if not normalized_a or not normalized_b:
        return False

    if normalized_a == normalized_b:
        return True
    if normalized_a in normalized_b or normalized_b in normalized_a:
        return True

    ratio = SequenceMatcher(None, normalized_a, normalized_b).ratio()
    if ratio >= 0.87:
        return True

    a_brand, _ = tokenize_item_name(name_a)
    b_brand, _ = tokenize_item_name(name_b)
    a_tokens = informative_name_tokens(name_a)
    b_tokens = informative_name_tokens(name_b)
    shared_info_tokens = a_tokens & b_tokens

    if len(shared_info_tokens) >= 3:
        return True

    if len(shared_info_tokens) >= 2 and (
        (a_brand and b_brand and a_brand == b_brand) or ratio >= 0.75
    ):
        return True

    return False


def build_record(item_name: str, item_price: str, item_img_url: str, item_web_listing: str) -> dict[str, str]:
    clean_name = clean_text(item_name)
    return {
        "item_name": clean_name,
        "item_price": clean_text(item_price),
        "item_gender": infer_gender(clean_name),
        "item_img_url": clean_url(item_img_url),
        "item_web_listing": clean_url(item_web_listing),
    }


def record_quality_score(record: dict[str, str]) -> int:
    score = 0
    if record["item_price"]:
        score += 2
    if record["item_img_url"]:
        score += 1
    if record["item_web_listing"]:
        score += 1
    if is_external_non_google_url(record["item_web_listing"]):
        score += 4
    return score


def add_or_update_record_by_name(records_by_name: dict[str, dict[str, str]], record: dict[str, str]) -> None:
    key = normalize_name(record["item_name"])
    if not key:
        return

    existing = records_by_name.get(key)
    if existing is None or record_quality_score(record) > record_quality_score(existing):
        records_by_name[key] = record


def extract_njfjte_listings(decoded_html: str) -> list[dict[str, str]]:
    records_by_name: dict[str, dict[str, str]] = {}

    for match in NJFJTE_PATTERN.finditer(decoded_html):
        aria_label = clean_text(match.group("label"))
        item_name = find_name_for_card(decoded_html, match.start(), match.end(), aria_label)
        if not item_name:
            continue

        item_price = find_price_for_card(decoded_html, match.start(), match.end(), aria_label)
        item_img_url = find_image_for_card(decoded_html, match.start(), match.end())

        offer_panel_url = find_offer_panel_external_url(
            decoded_html=decoded_html,
            card_start=match.start(),
            card_end=match.end(),
        )
        item_web_listing = offer_panel_url or build_google_listing_url(item_name)

        add_or_update_record_by_name(
            records_by_name,
            build_record(
                item_name=item_name,
                item_price=item_price,
                item_img_url=item_img_url,
                item_web_listing=item_web_listing,
            ),
        )

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
) -> tuple[int, Path, Path]:
    raw_html = input_html.read_text(encoding="utf-8", errors="ignore")
    decoded_html = decode_embedded_markup(raw_html)
    rows = extract_njfjte_listings(decoded_html)

    base_name = output_name_for_input(input_html, input_root)
    csv_path = output_csv_dir / f"{base_name}_njfjte_listings.csv"
    json_path = output_json_dir / f"{base_name}_njfjte_listings.json"

    write_csv(rows, csv_path)
    write_json(rows, json_path)

    return len(rows), csv_path, json_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract product listings from div.njFjte in saved Google Shopping HTML snapshots.",
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
    for html_file in html_files:
        row_count, csv_path, json_path = process_html_file(
            input_html=html_file,
            input_root=input_root,
            output_csv_dir=output_csv_dir,
            output_json_dir=output_json_dir,
        )

        total_rows += row_count
        print(f"{html_file.relative_to(input_root)} -> {row_count} rows")
        print(f"  CSV:  {csv_path}")
        print(f"  JSON: {json_path}")

    print(f"Done. Extracted {total_rows} total rows across {len(html_files)} files.")


if __name__ == "__main__":
    main()
