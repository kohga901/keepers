from __future__ import annotations

import concurrent.futures
import csv
import html
import json
import re
import base64
import urllib.parse
import urllib.request
from pathlib import Path

FIELDNAMES = [
	"item_name",
	"item_price",
	"gender",
	"img_url",
	"original_listing_url",
]

OFFER_LINK_LABELS = {
	"vplap": "Most popular",
	"vplaurlg": "Best price",
	"vplahcl": "Store offer",
}

PANTS_KEYWORDS = re.compile(
	r"\b(pant|pants|trouser|trousers|jogger|joggers|legging|leggings|chino|chinos|cargo|slacks|sweatpant|sweatpants)\b",
	re.IGNORECASE,
)

EXCLUDED_KEYWORDS = re.compile(
	r"\b(sock|socks|belt|belts|shoe|shoes|boot|boots|sandal|sandals|jacket|hoodie|shirt|sweater|hat)\b",
	re.IGNORECASE,
)

DIRECT_ANCHOR_PATTERN = re.compile(
	r'<a(?P<attrs>[^>]*class="[^"]*plantl[^"]*"[^>]*)>(?P<body>.*?)</a>',
	re.IGNORECASE | re.DOTALL,
)

HREF_PATTERN = re.compile(r'href="(?P<url>https?://[^"]+)"', re.IGNORECASE)

DIRECT_NAME_PATTERNS = [
	re.compile(r'<div class="r4awE[^"]*"[^>]*>\s*<div>(?P<name>.*?)</div>', re.IGNORECASE | re.DOTALL),
	re.compile(r'<div class="gkQHve[^"]*"[^>]*>(?P<name>.*?)</div>', re.IGNORECASE | re.DOTALL),
	re.compile(r'aria-label="\s*for\s*(?P<name>.*?)\s*from', re.IGNORECASE | re.DOTALL),
]

GKQHVE_NAME_PATTERN = re.compile(
	r'<div class="gkQHve[^"]*"[^>]*>(?P<name>.*?)</div>',
	re.IGNORECASE | re.DOTALL,
)

PRICE_TOKEN_PATTERN = re.compile(
	r'\$[0-9][0-9,]*(?:\.[0-9]{2})?',
	re.IGNORECASE,
)

ENCRYPTED_IMAGE_PATTERN = re.compile(
	r'https://encrypted-tbn\d\.gstatic\.com/shopping\?q=tbn:[^"\s<]+',
	re.IGNORECASE | re.DOTALL,
)

PLANTL_OPEN_ANCHOR_PATTERN = re.compile(
	r'<a(?P<attrs>[^>]*class="[^"]*plantl[^"]*"[^>]*)>',
	re.IGNORECASE | re.DOTALL,
)

FALLBACK_QUERY_PREFIX = "https://www.google.com/search?udm=28&q="
LIVE_ENRICH_TIMEOUT_SECONDS = 12
LIVE_ENRICH_MAX_WORKERS = 6

DUCKDUCKGO_RESULT_ANCHOR_PATTERN = re.compile(
	r'<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="(?P<href>[^"]+)"[^>]*>(?P<title>.*?)</a>',
	re.IGNORECASE | re.DOTALL,
)

TAG_PATTERN = re.compile(r"<[^>]+>")

BING_RESULT_ANCHOR_PATTERN = re.compile(
	r'<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>.*?<a[^>]*href="(?P<href>https?://[^"]+)"[^>]*>(?P<title>.*?)</a>',
	re.IGNORECASE | re.DOTALL,
)


def decode_embedded_markup(raw_html: str) -> str:
	# Google stores large parts of the shopping cards in escaped strings like \x3cdiv...
	decoded = re.sub(r"\\x([0-9a-fA-F]{2})", lambda m: chr(int(m.group(1), 16)), raw_html)
	decoded = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), decoded)
	decoded = decoded.replace("\\/", "/")
	decoded = decoded.replace('\\"', '"').replace("\\'", "'")
	return decoded


def clean_text(value: str) -> str:
	return re.sub(r"\s+", " ", html.unescape(value)).strip()


def clean_url(value: str) -> str:
	url = (value or "").strip()
	return url.replace("&amp;", "&")


def is_pants_item(item_name: str) -> bool:
	return bool(PANTS_KEYWORDS.search(item_name)) and not bool(EXCLUDED_KEYWORDS.search(item_name))


def normalize_name(item_name: str) -> str:
	# Normalizes names for robust name-to-url joins across HTML variants.
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
		"inseam",
		"fit",
		"classic",
		"slim",
		"baggy",
		"high",
		"waisted",
		"wide",
		"leg",
		"straight",
		"rise",
		"color",
		"grey",
		"gray",
		"black",
		"blue",
		"beige",
		"khaki",
		"navy",
		"green",
		"brown",
		"light",
		"dark",
		"ivory",
		"small",
		"medium",
		"large",
		"pants",
		"pant",
		"trouser",
		"trousers",
		"jogger",
		"joggers",
		"cargo",
		"sweatpants",
		"sweatpant",
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


def find_first_external_url_for_item(
	item_name: str,
	item_price: str,
	direct_records: list[dict[str, str]],
) -> str:
	item_brand, item_tokens = tokenize_item_name(item_name)
	normalized_item = normalize_name(item_name)

	for candidate in direct_records:
		candidate_name = candidate.get("item_name", "")
		candidate_url = candidate.get("original_listing_url", "")
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

		# Prefer the first external listing that appears to describe the same product family.
		if brands_match and shared_tokens:
			return candidate_url

		if item_price and candidate.get("item_price", "") == item_price and len(shared_tokens) >= 2:
			return candidate_url

	return ""


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
			"duckduckgo.com",
			"bing.com",
		]
	)


def infer_offer_label(anchor_id: str) -> str:
	prefix = (anchor_id or "").split("_", 1)[0]
	if prefix.startswith("vplaurlt"):
		return "Product page"
	return OFFER_LINK_LABELS.get(prefix, "External offer")


def extract_offer_links(html_fragment: str) -> list[dict[str, str]]:
	links: list[dict[str, str]] = []
	seen: set[tuple[str, str]] = set()

	for match in DIRECT_ANCHOR_PATTERN.finditer(html_fragment):
		attrs = match.group("attrs")
		href_match = HREF_PATTERN.search(attrs)
		if not href_match:
			continue

		url = clean_url(href_match.group("url"))
		if not is_external_non_google_url(url):
			continue

		id_match = re.search(r'id="(?P<id>[^"]+)"', attrs, flags=re.IGNORECASE)
		label = infer_offer_label(id_match.group("id") if id_match else "")

		key = (label, url)
		if key in seen:
			continue
		seen.add(key)
		links.append({"label": label, "url": url})

	return links


def select_best_price_url(offer_links: list[dict[str, str]], fallback_url: str) -> str:
	for link in offer_links:
		if link.get("label") == "Best price" and link.get("url"):
			return link["url"]
	if offer_links and offer_links[0].get("url"):
		return offer_links[0]["url"]
	return fallback_url


def build_google_fallback_url(item_name: str) -> str:
	query = urllib.parse.quote_plus(item_name)
	return f"https://www.google.com/search?udm=28&q={query}"


def fetch_page_html(url: str, timeout_seconds: int = LIVE_ENRICH_TIMEOUT_SECONDS) -> str:
	request = urllib.request.Request(
		url,
		headers={
			"User-Agent": "Mozilla/5.0",
			"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			"Accept-Language": "en-US,en;q=0.9",
		},
	)
	with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
		charset = response.headers.get_content_charset() or "utf-8"
		return response.read().decode(charset, errors="ignore")


def extract_first_external_listing_url(page_html: str) -> str:
	decoded_html = decode_embedded_markup(page_html)

	for match in PLANTL_OPEN_ANCHOR_PATTERN.finditer(decoded_html):
		attrs = match.group("attrs")
		href_match = HREF_PATTERN.search(attrs)
		if not href_match:
			continue

		url = clean_url(href_match.group("url"))
		if is_external_non_google_url(url):
			return url

	return ""


def resolve_duckduckgo_redirect_url(href: str) -> str:
	resolved = clean_url(html.unescape(href))
	if resolved.startswith("//"):
		resolved = "https:" + resolved

	parsed = urllib.parse.urlparse(resolved)
	if "duckduckgo.com" in parsed.netloc.casefold() and parsed.path.startswith("/l/"):
		target = urllib.parse.parse_qs(parsed.query).get("uddg", [""])[0]
		return clean_url(target)

	return resolved


def extract_query_text_from_fallback_url(query_url: str) -> str:
	parsed = urllib.parse.urlparse(query_url)
	return urllib.parse.parse_qs(parsed.query).get("q", [""])[0]


def resolve_bing_tracking_url(url: str) -> str:
	resolved = clean_url(html.unescape(url))
	parsed = urllib.parse.urlparse(resolved)
	if "bing.com" not in parsed.netloc.casefold():
		return resolved

	u_param = urllib.parse.parse_qs(parsed.query).get("u", [""])[0]
	if not u_param:
		return resolved

	encoded = u_param[2:] if u_param.startswith("a1") else u_param
	padding = "=" * ((4 - (len(encoded) % 4)) % 4)
	try:
		target = base64.urlsafe_b64decode((encoded + padding).encode("ascii")).decode("utf-8", errors="ignore")
	except Exception:
		return resolved

	target = clean_url(target)
	return target if target.startswith(("http://", "https://")) else resolved


def extract_first_external_url_from_bing(query_text: str) -> str:
	if not query_text:
		return ""

	search_url = f"https://www.bing.com/search?q={urllib.parse.quote_plus(query_text)}"
	try:
		search_html = fetch_page_html(search_url)
	except Exception:
		return ""

	_, query_tokens = tokenize_item_name(query_text)
	query_brand, _ = tokenize_item_name(query_text)

	for match in BING_RESULT_ANCHOR_PATTERN.finditer(search_html):
		resolved_url = resolve_bing_tracking_url(match.group("href"))
		if not is_external_non_google_url(resolved_url):
			continue

		title_text = clean_text(TAG_PATTERN.sub(" ", match.group("title")))
		_, title_tokens = tokenize_item_name(title_text)
		parsed_url = urllib.parse.urlparse(resolved_url)
		url_text = parsed_url.netloc + " " + parsed_url.path
		_, url_tokens = tokenize_item_name(url_text)
		combined_tokens = title_tokens | url_tokens
		shared = len(query_tokens & combined_tokens)

		path_text = f"{parsed_url.path} {parsed_url.query}".casefold()
		has_product_hint = any(
			token in path_text
			for token in ["/p/", "/dp/", "product", "products", "item", "pants", "trouser", "jogger", "cargo", "legging"]
		)

		brand_bonus = 0
		netloc = parsed_url.netloc.casefold()
		if query_brand and len(query_brand) >= 3 and query_brand in netloc:
			brand_bonus = 2

		if shared >= 2 and (brand_bonus > 0 or has_product_hint):
			return resolved_url

		if shared >= 1 and brand_bonus > 0 and has_product_hint:
			return resolved_url

	return ""


def extract_first_external_url_from_duckduckgo(query_text: str) -> str:
	if not query_text:
		return ""

	search_url = f"https://duckduckgo.com/html/?q={urllib.parse.quote_plus(query_text)}"
	try:
		search_html = fetch_page_html(search_url)
	except Exception:
		return ""

	_, query_tokens = tokenize_item_name(query_text)
	first_candidate = ""

	for match in DUCKDUCKGO_RESULT_ANCHOR_PATTERN.finditer(search_html):
		resolved_url = resolve_duckduckgo_redirect_url(match.group("href"))
		if not is_external_non_google_url(resolved_url):
			continue

		if not first_candidate:
			first_candidate = resolved_url

		title_text = clean_text(TAG_PATTERN.sub(" ", match.group("title")))
		_, title_tokens = tokenize_item_name(title_text)
		if not query_tokens:
			return resolved_url

		shared = len(query_tokens & title_tokens)
		if shared / max(1, len(query_tokens)) >= 0.3:
			return resolved_url

	return first_candidate


def enrich_fallback_urls_with_live_results(rows: list[dict[str, str]], cache_path: Path) -> list[dict[str, str]]:
	fallback_urls = sorted(
		{
			row["original_listing_url"]
			for row in rows
			if row.get("original_listing_url", "").startswith(FALLBACK_QUERY_PREFIX)
		}
	)
	if not fallback_urls:
		return rows

	# Recompute live results on each run to avoid keeping stale or low-quality cached mappings.
	url_cache: dict[str, str] = {}
	missing_urls = list(fallback_urls)

	def resolve_query_url(query_url: str) -> tuple[str, str]:
		try:
			page_html = fetch_page_html(query_url)
		except Exception:
			page_html = ""

		external_url = extract_first_external_listing_url(page_html) if page_html else ""
		if external_url:
			return query_url, external_url

		query_text = extract_query_text_from_fallback_url(query_url)
		bing_url = extract_first_external_url_from_bing(query_text)
		if bing_url:
			return query_url, bing_url

		duckduckgo_url = extract_first_external_url_from_duckduckgo(query_text)
		return query_url, duckduckgo_url

	if missing_urls:
		with concurrent.futures.ThreadPoolExecutor(max_workers=LIVE_ENRICH_MAX_WORKERS) as executor:
			for query_url, external_url in executor.map(resolve_query_url, missing_urls):
				if external_url:
					url_cache[query_url] = external_url

	try:
		cache_path.write_text(json.dumps(url_cache, ensure_ascii=False, indent=2), encoding="utf-8")
	except Exception:
		pass

	for row in rows:
		query_url = row.get("original_listing_url", "")
		external_url = url_cache.get(query_url, "")
		if external_url:
			row["original_listing_url"] = external_url

	return rows


def infer_gender(item_name: str) -> str:
	lowered = item_name.lower()

	if any(token in lowered for token in ["women", "women's", "womens", "lady", "ladies", "female", "girl", "girls"]):
		return "women"
	if any(token in lowered for token in ["men", "men's", "mens", "male", "boy", "boys"]):
		return "men"
	if "unisex" in lowered:
		return "unisex"
	return "unknown"


def extract_source_page_url(decoded_html: str) -> str:
	for pattern in [
		r'<meta property="og:url" content="([^"]+)"',
		r'<link rel="canonical" href="([^"]+)"',
	]:
		match = re.search(pattern, decoded_html, flags=re.IGNORECASE)
		if match:
			return clean_text(match.group(1))

	return "https://www.google.com/search?udm=28&q=pants"


def build_record(
	item_name: str,
	item_price: str,
	img_url: str,
	original_listing_url: str,
) -> dict[str, str]:
	clean_name = clean_text(item_name)
	return {
		"item_name": clean_name,
		"item_price": clean_text(item_price),
		"gender": infer_gender(clean_name),
		"img_url": clean_url(img_url),
		"original_listing_url": clean_url(original_listing_url),
	}


def record_quality_score(record: dict[str, str]) -> int:
	score = 0
	if record["item_price"]:
		score += 2
	if record["img_url"]:
		score += 1
	if is_external_non_google_url(record["original_listing_url"]):
		score += 4
	return score


def add_or_update_record_by_name(
	records_by_name: dict[str, dict[str, str]],
	record: dict[str, str],
) -> None:
	key = normalize_name(record["item_name"])
	existing = records_by_name.get(key)

	if existing is None:
		records_by_name[key] = record
		return

	if record_quality_score(record) > record_quality_score(existing):
		records_by_name[key] = record


def extract_direct_records(decoded_html: str) -> list[dict[str, str]]:
	direct_records: list[dict[str, str]] = []

	for match in DIRECT_ANCHOR_PATTERN.finditer(decoded_html):
		attrs = match.group("attrs")
		if "tkXAec" not in attrs:
			continue
		href_match = HREF_PATTERN.search(attrs)
		if not href_match:
			continue

		href = clean_text(href_match.group("url"))
		if not is_external_non_google_url(href):
			continue

		# Constrain extraction to the current pla-unit block to avoid leaking links from nearby cards.
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
			name_match = pattern.search(scope)
			if name_match:
				candidate = clean_text(name_match.group("name"))
				if candidate:
					item_name = candidate
					break

		if not item_name or not is_pants_item(item_name):
			continue

		price_match = PRICE_TOKEN_PATTERN.search(context)
		img_match = ENCRYPTED_IMAGE_PATTERN.search(context)
		offer_links = extract_offer_links(context)
		primary_url = select_best_price_url(offer_links, href)

		direct_records.append(
			build_record(
				item_name=item_name,
				item_price=price_match.group(0) if price_match else "",
				img_url=img_match.group(0) if img_match else "",
				original_listing_url=primary_url,
			)
		)

	return direct_records


def extract_pants_listings(decoded_html: str) -> list[dict[str, str]]:
	_ = extract_source_page_url(decoded_html)
	direct_records = extract_direct_records(decoded_html)
	direct_url_by_name = {
		normalize_name(record["item_name"]): record["original_listing_url"]
		for record in direct_records
	}
	records_by_name: dict[str, dict[str, str]] = {}

	for match in GKQHVE_NAME_PATTERN.finditer(decoded_html):
		item_name = clean_text(match.group("name"))
		if not item_name or not is_pants_item(item_name):
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
		first_external_url = direct_url or find_first_external_url_for_item(item_name, item_price, direct_records)
		original_listing_url = first_external_url or build_google_fallback_url(item_name)

		record = build_record(
			item_name=item_name,
			item_price=item_price,
			img_url=img_url,
			original_listing_url=original_listing_url,
		)
		add_or_update_record_by_name(records_by_name, record)

	for record in direct_records:
		add_or_update_record_by_name(records_by_name, record)

	return sorted(records_by_name.values(), key=lambda item: item["item_name"].lower())


def write_json(rows: list[dict[str, str]], output_path: Path) -> None:
	output_path.parent.mkdir(parents=True, exist_ok=True)
	with output_path.open("w", encoding="utf-8") as fp:
		json.dump(rows, fp, ensure_ascii=False, indent=2)


def write_csv(rows: list[dict[str, str]], output_path: Path) -> None:
	output_path.parent.mkdir(parents=True, exist_ok=True)
	with output_path.open("w", encoding="utf-8", newline="") as fp:
		writer = csv.DictWriter(fp, fieldnames=FIELDNAMES)
		writer.writeheader()
		writer.writerows(rows)


def main() -> None:
	base_dir = Path(__file__).resolve().parent
	input_html = base_dir / "shoppingHTML" / "Bottoms" / "pants.html"
	output_csv = base_dir / "shoppingListingCSV" / "pants_listings.csv"
	output_json = base_dir / "shoppingListingJSON" / "pants_listings.json"
	cache_json = base_dir / "shoppingListingJSON" / "pants_external_url_cache.json"

	raw_html = input_html.read_text(encoding="utf-8", errors="ignore")
	decoded_html = decode_embedded_markup(raw_html)
	rows = extract_pants_listings(decoded_html)
	rows = enrich_fallback_urls_with_live_results(rows, cache_json)

	write_csv(rows, output_csv)
	write_json(rows, output_json)

	print(f"Extracted {len(rows)} pants listings")
	print(f"CSV:  {output_csv}")
	print(f"JSON: {output_json}")


if __name__ == "__main__":
	main()
