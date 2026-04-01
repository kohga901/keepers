(async () => {
  const MAX_ITEMS = null; // null = all cards, or set a number like 50
  const CARD_SELECTOR = "div.njFjte";
  const OFFER_LIST_SELECTOR = "div[data-ntof][role='list']";
  const TITLE_SELECTOR = "div.gkQHve";
  const PRICE_RE = /\$[0-9][0-9,]*(?:\.[0-9]{2})?/;
  const ENCRYPTED_IMAGE_RE = /encrypted-tbn\d\.gstatic\.com\/shopping/i;
  const DETAIL_IMG_SELECTOR = "img.KfAt4d, img.kfAt4d";
  const IMAGE_ICON_RE = /(favicon|faviconv2|googlelogo|\/images\/icons\/|\/branding\/)/i;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (v) => (v || "").replace(/\s+/g, " ").trim();
  const jitter = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const htmlEntityDecoder = document.createElement("textarea");

  function toAbsUrl(href) {
    try {
      return new URL(href, location.href).href;
    } catch {
      return "";
    }
  }

  function hostFromUrl(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  }

  function isGoogleFamilyHost(host) {
    return /(^|\.)(google|gstatic|googleusercontent|doubleclick)\./i.test(host || "");
  }

  function isExternalNonGoogleUrl(url) {
    if (!/^https?:\/\//i.test(url)) {
      return false;
    }
    const host = hostFromUrl(url);
    if (!host) {
      return false;
    }
    return !isGoogleFamilyHost(host);
  }

  function buildGoogleFallback(itemName) {
    return "https://www.google.com/search?udm=28&q=" + encodeURIComponent(itemName || "");
  }

  function inferGenderFromText(value) {
    const lowered = (value || "").toLowerCase();
    if (!lowered) {
      return "";
    }

    const hasWomen = /\b(women|women's|womens|woman|lady|ladies|female|girl|girls)\b/.test(
      lowered
    );
    const hasMen = /\b(men|men's|mens|man|male|boy|boys)\b/.test(lowered);
    const hasUnisex = /\bunisex\b/.test(lowered);

    if (hasUnisex || (hasWomen && hasMen)) {
      return "unisex";
    }
    if (hasWomen) {
      return "women";
    }
    if (hasMen) {
      return "men";
    }

    return "";
  }

  function inferGenderFromWebListing(itemWebListing) {
    const href = clean(itemWebListing || "");
    if (!href) {
      return "";
    }

    const parts = [];
    try {
      const urlObj = new URL(href);
      parts.push(urlObj.hostname);
      parts.push(urlObj.pathname);
      parts.push(urlObj.search);

      for (const [key, value] of urlObj.searchParams.entries()) {
        parts.push(key);
        parts.push(value);
      }
    } catch {
      parts.push(href);
    }

    const combined = parts
      .join(" ")
      .replace(/[-_/=+?&.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return inferGenderFromText(combined);
  }

  function inferGender(itemName, itemWebListing) {
    const fromName = inferGenderFromText(itemName);
    const fromUrl = inferGenderFromWebListing(itemWebListing);

    if (fromName === "unisex" || fromUrl === "unisex") {
      return "unisex";
    }
    if (fromName && fromUrl && fromName !== fromUrl) {
      return "unisex";
    }
    if (fromName) {
      return fromName;
    }
    if (fromUrl) {
      return fromUrl;
    }
    return "unknown";
  }

  function parseNameFromAriaLabel(ariaLabel) {
    const prefix = clean(ariaLabel || "").split("Current Price:", 1)[0];
    const parts = prefix.split(".").map((part) => clean(part)).filter(Boolean);

    for (const sentence of parts) {
      const lowered = sentence.toLowerCase();
      if (lowered.startsWith("nearby,")) {
        continue;
      }
      if (lowered.includes("% off")) {
        continue;
      }
      if (lowered.startsWith("was $")) {
        continue;
      }
      return sentence;
    }

    return clean(prefix);
  }

  function extractItemName(card) {
    const fromTitle = clean(card.querySelector(TITLE_SELECTOR)?.textContent || "");
    if (fromTitle) {
      return fromTitle;
    }
    return parseNameFromAriaLabel(card.getAttribute("aria-label") || "");
  }

  function extractPrice(card) {
    const ariaLabel = card.getAttribute("aria-label") || "";
    const fromAria = ariaLabel.match(/Current Price:\s*(\$[0-9][0-9,]*(?:\.[0-9]{2})?)/i);
    if (fromAria) {
      return clean(fromAria[1]);
    }

    const fromText = clean(card.textContent || "").match(PRICE_RE);
    return fromText ? clean(fromText[0]) : "";
  }

  function splitSrcset(srcset) {
    if (!srcset) {
      return [];
    }

    const candidates = srcset
      .split(",")
      .map((entry) => {
        const parts = clean(entry).split(/\s+/);
        const url = clean(parts[0] || "");
        const descriptor = clean(parts[1] || "");

        let rank = 0;
        const widthMatch = descriptor.match(/^(\d+)w$/i);
        const densityMatch = descriptor.match(/^([0-9.]+)x$/i);
        if (widthMatch) {
          rank = Number(widthMatch[1]);
        } else if (densityMatch) {
          rank = Math.round(Number(densityMatch[1]) * 1000);
        }

        return { url, rank };
      })
      .filter((entry) => entry.url);

    candidates.sort((a, b) => b.rank - a.rank);
    return candidates.map((entry) => entry.url);
  }

  function isLikelyIconUrl(url) {
    return IMAGE_ICON_RE.test(url || "");
  }

  function sizeHintFromUrl(url) {
    const value = clean(url || "");
    if (!value) {
      return 0;
    }

    const checks = [
      /[?&](?:w|width)=(\d{2,4})/i,
      /[?&](?:h|height)=(\d{2,4})/i,
      /=w(\d{2,4})-h(\d{2,4})/i,
      /[?&]sz=(\d{2,4})/i,
      /\/s(\d{2,4})(?:[-/?]|$)/i,
    ];

    let best = 0;
    for (const re of checks) {
      const match = value.match(re);
      if (!match) {
        continue;
      }
      for (let i = 1; i < match.length; i += 1) {
        const num = Number(match[i]);
        if (Number.isFinite(num)) {
          best = Math.max(best, num);
        }
      }
    }

    return best;
  }

  function scoreImageUrl(url, index = 0) {
    const host = hostFromUrl(url);
    const nonGoogleHost = Boolean(host) && !isGoogleFamilyHost(host);
    const sizeHint = sizeHintFromUrl(url);

    let score = 0;
    score += Math.max(0, 25 - index);
    if (nonGoogleHost) {
      score += 80;
    }
    if (ENCRYPTED_IMAGE_RE.test(url)) {
      score += 30;
    }
    if (isLikelyIconUrl(url)) {
      score -= 260;
    }
    if (isGoogleFamilyHost(host)) {
      score -= 20;
    }
    score += Math.min(160, sizeHint / 3);
    if (/([?&]size=|[?&]sz=)(\d{1,2})(?:[&#]|$)/i.test(url)) {
      score -= 70;
    }

    return score;
  }

  function pickBestImageUrl(urls) {
    if (!urls || urls.length === 0) {
      return "";
    }

    const unique = Array.from(new Set(urls))
      .filter(Boolean)
      .filter((u) => /^https?:\/\//i.test(u));

    let best = { score: Number.NEGATIVE_INFINITY, url: "" };
    for (let i = 0; i < unique.length; i += 1) {
      const url = unique[i];
      const score = scoreImageUrl(url, i);
      if (score > best.score) {
        best = { score, url };
      }
    }

    return best.url;
  }

  function isVisibleImage(img) {
    if (!img) {
      return false;
    }
    const style = window.getComputedStyle(img);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = img.getBoundingClientRect();
    return rect.width >= 60 && rect.height >= 60 && rect.bottom > 0 && rect.top < window.innerHeight;
  }

  function imageUrlsFromImg(img) {
    if (!img) {
      return [];
    }

    const urls = [
      ...splitSrcset(img.srcset || ""),
      ...splitSrcset(img.getAttribute("srcset") || ""),
      ...splitSrcset(img.getAttribute("data-srcset") || ""),
      clean(img.currentSrc || ""),
      clean(img.src || ""),
      clean(img.getAttribute("src") || ""),
      clean(img.getAttribute("data-src") || ""),
    ];

    return Array.from(new Set(urls)).filter((u) => /^https?:\/\//i.test(u));
  }

  function extractImage(offerListEl) {
    const roots = [];

    if (offerListEl) {
      const panelRoot =
        offerListEl.closest("[role='dialog'], [role='complementary'], aside, section") ||
        offerListEl.parentElement ||
        offerListEl;
      roots.push(panelRoot);
    }

    roots.push(document);

    // After clicking an njFjte card, the detail pane only exposes that card's KfAt4d image.
    for (const root of roots) {
      const visibleDetail = Array.from(root.querySelectorAll(DETAIL_IMG_SELECTOR)).find((img) =>
        isVisibleImage(img)
      );
      const detailImg = visibleDetail || root.querySelector(DETAIL_IMG_SELECTOR);
      if (!detailImg) {
        continue;
      }

      const picked = pickBestImageUrl(imageUrlsFromImg(detailImg));
      if (picked) {
        return picked;
      }
    }

    return "";
  }

  function normalizeName(value) {
    return (value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function recordQualityScore(record) {
    let score = 0;
    if (record.item_price) {
      score += 2;
    }
    if (record.item_img) {
      score += 1;
    }
    if (record.item_web_listing) {
      score += 1;
    }
    if (isExternalNonGoogleUrl(record.item_web_listing)) {
      score += 4;
    }
    return score;
  }

  function dedupeRowsByName(rows) {
    const byName = new Map();

    for (const row of rows) {
      const key = normalizeName(row.item_name);
      if (!key) {
        continue;
      }

      const existing = byName.get(key);
      if (!existing || recordQualityScore(row) > recordQualityScore(existing)) {
        byName.set(key, row);
      }
    }

    return Array.from(byName.values()).sort((a, b) => a.item_name.localeCompare(b.item_name));
  }

  function firstExternalHrefFromList(listEl) {
    if (!listEl) {
      return "";
    }

    const anchors = Array.from(
      listEl.querySelectorAll("a[data-hveid][data-ved][href], a[href^='http']")
    );

    for (const a of anchors) {
      const href = toAbsUrl(a.getAttribute("href") || a.href || "");
      if (isExternalNonGoogleUrl(href)) {
        return href;
      }
    }

    return "";
  }

  function dataNtofForList(listEl) {
    if (!listEl) {
      return "";
    }

    const own = clean(listEl.getAttribute("data-ntof") || "");
    if (own) {
      return own;
    }

    const ancestor = listEl.closest("[data-ntof]");
    if (ancestor) {
      const fromAncestor = clean(ancestor.getAttribute("data-ntof") || "");
      if (fromAncestor) {
        return fromAncestor;
      }
    }

    return "";
  }

  async function waitForOfferList(timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const listEl = document.querySelector(OFFER_LIST_SELECTOR);
      if (listEl) {
        const offerCtx = {
          listEl,
          dataNtof: dataNtofForList(listEl),
          firstExternal: firstExternalHrefFromList(listEl),
        };

        if (offerCtx.dataNtof || offerCtx.firstExternal) {
          return offerCtx;
        }
      }

      await sleep(jitter(170, 300));
    }

    const fallbackList = document.querySelector(OFFER_LIST_SELECTOR);
    if (!fallbackList) {
      return null;
    }

    return {
      listEl: fallbackList,
      dataNtof: dataNtofForList(fallbackList),
      firstExternal: firstExternalHrefFromList(fallbackList),
    };
  }

  async function expandOffersList(listEl) {
    if (!listEl) {
      return;
    }

    let stablePasses = 0;
    let lastHeight = -1;

    for (let i = 0; i < 22; i += 1) {
      listEl.scrollTop = listEl.scrollHeight;
      await sleep(jitter(220, 360));

      const h = listEl.scrollHeight;
      if (h === lastHeight) {
        stablePasses += 1;
      } else {
        stablePasses = 0;
      }
      lastHeight = h;

      if (stablePasses >= 3) {
        break;
      }
    }

    listEl.scrollTop = 0;
  }

  async function warmPageCards(maxPasses = 70) {
    let stablePasses = 0;
    let lastCount = 0;

    for (let pass = 0; pass < maxPasses; pass += 1) {
      const count = document.querySelectorAll(CARD_SELECTOR).length;
      if (count === lastCount) {
        stablePasses += 1;
      } else {
        stablePasses = 0;
      }
      lastCount = count;

      window.scrollBy(0, Math.floor(window.innerHeight * 0.9));
      await sleep(jitter(360, 580));

      if (stablePasses >= 4) {
        break;
      }
    }

    window.scrollTo(0, 0);
    await sleep(400);
  }

  await warmPageCards();

  const allCards = Array.from(document.querySelectorAll(CARD_SELECTOR));
  const parsedMax = Number(MAX_ITEMS);
  const effectiveMax = Number.isFinite(parsedMax) && parsedMax > 0 ? Math.floor(parsedMax) : null;
  const cards = effectiveMax ? allCards.slice(0, effectiveMax) : allCards;

  console.log("Found", allCards.length, "cards. Processing", cards.length);

  const rows = [];

  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    card.scrollIntoView({ block: "center", inline: "nearest" });
    await sleep(jitter(250, 440));

    const itemName = extractItemName(card);
    const itemPrice = extractPrice(card);

    card.click();
    await sleep(jitter(330, 560));

    let offerCtx = await waitForOfferList(9000);

    if (offerCtx && offerCtx.listEl) {
      await expandOffersList(offerCtx.listEl);
      offerCtx = {
        listEl: offerCtx.listEl,
        dataNtof: dataNtofForList(offerCtx.listEl),
        firstExternal: firstExternalHrefFromList(offerCtx.listEl),
      };
    }

    const itemImg = extractImage(offerCtx && offerCtx.listEl ? offerCtx.listEl : null);
    const itemWebListing =
      (offerCtx && offerCtx.firstExternal) || buildGoogleFallback(itemName);
    const itemGender = inferGender(itemName, itemWebListing);

    rows.push({
      item_name: itemName,
      item_price: itemPrice,
      item_gender: itemGender,
      item_img: itemImg,
      item_web_listing: itemWebListing,
    });

    console.log("Captured", i + 1, "/", cards.length, "-", itemName);
    await sleep(jitter(220, 420));
  }

  const finalRows = dedupeRowsByName(rows);

  console.table(finalRows);
  window.__googleShoppingListings = finalRows;

  const json = JSON.stringify(finalRows, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    console.log("Copied JSON to clipboard.");
  } catch {
    console.log("Clipboard copy not allowed here. Download still works.");
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "google_shopping_njfjte_" + stamp + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);

  console.log("Done. Captured", rows.length, "raw rows and", finalRows.length, "deduped rows.");
})();

