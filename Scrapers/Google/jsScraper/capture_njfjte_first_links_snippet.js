(async () => {
  const MAX_ITEMS = 5; // null = all cards, or set a number like 50
  const CARD_SELECTOR = "div.njFjte";
  const TITLE_SELECTOR = "div.gkQHve";
  const PRICE_RE = /\$[0-9][0-9,]*(?:\.[0-9]{2})?/;
  const ENCRYPTED_IMAGE_RE = /encrypted-tbn\d\.gstatic\.com\/shopping/i;
  const DETAIL_IMG_SELECTOR = "img.KfAt4d";
  const IMAGE_ICON_RE = /(favicon|faviconv2|googlelogo|\/images\/icons\/|\/branding\/)/i;
  const CARD_HTML_RE =
    /<div[^>]*class="[^"]*njFjte[^"]*"[^>]*aria-label="(?<label>[^"]+)"[^>]*>/gi;
  const ENCRYPTED_IMAGE_HTML_RE =
    /https:\/\/encrypted-tbn\d\.gstatic\.com\/shopping\?q=tbn:[^"\s<]+/gi;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (v) => (v || "").replace(/\s+/g, " ").trim();
  const jitter = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const htmlEntityDecoder = document.createElement("textarea");

  function decodeEmbeddedMarkup(rawHtml) {
    if (!rawHtml) {
      return "";
    }

    let decoded = rawHtml.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    );
    decoded = decoded.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    );
    decoded = decoded.replace(/\\\//g, "/");
    decoded = decoded.replace(/\\"/g, '"').replace(/\\'/g, "'");
    return decoded;
  }

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

  function cleanUrl(value) {
    return decodeHtmlEntities(value || "").trim();
  }

  function inferGender(itemName) {
    const lowered = (itemName || "").toLowerCase();
    if (/(women|women's|womens|lady|ladies|female|girl|girls)/.test(lowered)) {
      return "women";
    }
    if (/(men|men's|mens|male|boy|boys)/.test(lowered)) {
      return "men";
    }
    if (/unisex/.test(lowered)) {
      return "unisex";
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

  function decodeHtmlEntities(value) {
    if (!value) {
      return "";
    }
    htmlEntityDecoder.innerHTML = value;
    return clean(htmlEntityDecoder.value || htmlEntityDecoder.textContent || "");
  }

  function normalizeLookupText(value) {
    return decodeHtmlEntities(value)
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9$]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findBestEncryptedImageNearCard(html, cardStart, cardEnd) {
    const contextStart = Math.max(0, cardStart - 4000);
    const contextEnd = Math.min(html.length, cardEnd + 5000);
    const context = html.slice(contextStart, contextEnd);

    let bestUrl = "";
    let bestScore = Number.POSITIVE_INFINITY;
    let match = null;

    ENCRYPTED_IMAGE_HTML_RE.lastIndex = 0;
    while ((match = ENCRYPTED_IMAGE_HTML_RE.exec(context)) !== null) {
      const absolutePos = contextStart + match.index;
      const score = absolutePos >= cardEnd ? absolutePos - cardEnd : cardStart - absolutePos + 800;

      if (score < bestScore) {
        bestScore = score;
        bestUrl = decodeHtmlEntities(match[0]);
      }
    }

    return cleanUrl(bestUrl);
  }

  function buildHtmlProximityImageEntries(html) {
    const entries = [];
    if (!html) {
      return entries;
    }

    CARD_HTML_RE.lastIndex = 0;
    let match = null;
    while ((match = CARD_HTML_RE.exec(html)) !== null) {
      const rawLabel = match.groups && match.groups.label ? match.groups.label : "";
      const label = decodeHtmlEntities(rawLabel);
      const key = normalizeLookupText(label);
      if (!key) {
        continue;
      }

      const cardStart = match.index;
      const cardEnd = match.index + match[0].length;
      const imageUrl = findBestEncryptedImageNearCard(html, cardStart, cardEnd);

      entries.push({
        key,
        imageUrl,
        cardStart,
        cardEnd,
      });
    }

    return entries;
  }

  function buildHtmlEntryLookupByKey(entries) {
    const lookup = new Map();
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const list = lookup.get(entry.key) || [];
      list.push({ index: i, imageUrl: entry.imageUrl || "" });
      lookup.set(entry.key, list);
    }
    return lookup;
  }

  function findHtmlProximityImageForCard(card, cardIndex, htmlEntries, htmlEntryLookup) {
    if (!card || !htmlEntries || htmlEntries.length === 0) {
      return "";
    }

    const byIndex = htmlEntries[cardIndex];
    if (byIndex && byIndex.imageUrl) {
      return cleanUrl(byIndex.imageUrl);
    }

    const ariaLabel = clean(card.getAttribute("aria-label") || "");
    const key = normalizeLookupText(ariaLabel);
    if (!key) {
      return "";
    }

    const candidates = (htmlEntryLookup && htmlEntryLookup.get(key)) || [];
    if (candidates.length === 0) {
      return "";
    }

    let best = { distance: Number.POSITIVE_INFINITY, imageUrl: "" };
    for (const candidate of candidates) {
      if (!candidate.imageUrl) {
        continue;
      }
      const distance = Math.abs(candidate.index - cardIndex);
      if (distance < best.distance) {
        best = { distance, imageUrl: candidate.imageUrl };
      }
    }

    return cleanUrl(best.imageUrl || "");
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

  function isLikelyTinyImage(img) {
    if (!img) {
      return false;
    }

    const className = String(img.className || "");
    if (/\bXNo5Ab\b/i.test(className)) {
      return true;
    }

    const naturalW = Number(img.naturalWidth || 0);
    const naturalH = Number(img.naturalHeight || 0);
    if (naturalW > 0 && naturalH > 0 && (naturalW <= 64 || naturalH <= 64)) {
      return true;
    }

    const rect = img.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && (rect.width <= 32 || rect.height <= 32);
  }

  function backgroundImageUrls(styleValue) {
    if (!styleValue) {
      return [];
    }
    const urls = [];
    const re = /url\(("|')?(?<url>[^"')]+)("|')?\)/gi;
    let match = null;
    while ((match = re.exec(styleValue)) !== null) {
      const u = clean(match.groups && match.groups.url ? match.groups.url : "");
      if (u) {
        urls.push(u);
      }
    }
    return urls;
  }

  function collectImageUrls(rootEl) {
    if (!rootEl) {
      return [];
    }

    const urls = [];

    for (const img of Array.from(rootEl.querySelectorAll("img"))) {
      if (isLikelyTinyImage(img)) {
        continue;
      }

      urls.push(...splitSrcset(img.srcset || ""));
      urls.push(...splitSrcset(img.getAttribute("srcset") || ""));
      urls.push(...splitSrcset(img.getAttribute("data-srcset") || ""));
      urls.push(clean(img.currentSrc || ""));
      urls.push(clean(img.src || ""));
      urls.push(clean(img.getAttribute("src") || ""));
      urls.push(clean(img.getAttribute("data-src") || ""));
    }

    for (const el of Array.from(rootEl.querySelectorAll("[style*='background-image']"))) {
      urls.push(...backgroundImageUrls(el.getAttribute("style") || ""));
      urls.push(...backgroundImageUrls(window.getComputedStyle(el).backgroundImage || ""));
    }

    return Array.from(new Set(urls))
      .filter(Boolean)
      .filter((u) => /^https?:\/\//i.test(u));
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

  function bestKfAt4dImage(card, offerListEl) {
    if (!card) {
      return "";
    }

    const cardRect = card.getBoundingClientRect();
    const cardCx = cardRect.left + cardRect.width / 2;
    const cardCy = cardRect.top + cardRect.height / 2;

    let panelRoot = null;
    if (offerListEl) {
      panelRoot =
        offerListEl.closest("[role='dialog'], [role='complementary'], aside, section") ||
        offerListEl.parentElement ||
        offerListEl;
    }

    const scopes = [
      { root: card, bonus: 5000 },
      ...(panelRoot ? [{ root: panelRoot, bonus: 3500 }] : []),
      { root: document, bonus: 0 },
    ];

    const seen = new Set();
    let best = { score: Number.NEGATIVE_INFINITY, url: "" };

    for (const scope of scopes) {
      const imgs = Array.from(scope.root.querySelectorAll(DETAIL_IMG_SELECTOR));
      for (const img of imgs) {
        if (seen.has(img)) {
          continue;
        }
        seen.add(img);

        if (!isVisibleImage(img)) {
          continue;
        }

        const url = pickBestImageUrl(imageUrlsFromImg(img));
        if (!url) {
          continue;
        }

        const rect = img.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dist = Math.hypot(cx - cardCx, cy - cardCy);
        const area = rect.width * rect.height;
        const naturalArea = Number(img.naturalWidth || 0) * Number(img.naturalHeight || 0);
        const score =
          scope.bonus +
          scoreImageUrl(url) +
          Math.min(area, 80000) +
          Math.min(220, naturalArea / 5000) -
          dist * 2 -
          (isLikelyTinyImage(img) ? 220 : 0);

        if (score > best.score) {
          best = { score, url };
        }
      }
    }

    return best.url;
  }

  function extractImage(card, cardIndex, offerListEl, htmlEntries, htmlEntryLookup) {
    const imageCandidates = [];

    const fromHtmlProximity = findHtmlProximityImageForCard(
      card,
      cardIndex,
      htmlEntries,
      htmlEntryLookup
    );
    if (fromHtmlProximity) {
      imageCandidates.push({ url: fromHtmlProximity, source: "html-proximity" });
    }

    const fromDetail = bestKfAt4dImage(card, offerListEl);
    if (fromDetail) {
      imageCandidates.push({ url: fromDetail, source: "detail" });
    }

    const fromCard = pickBestImageUrl(collectImageUrls(card));
    if (fromCard) {
      imageCandidates.push({ url: fromCard, source: "card" });
    }

    if (offerListEl) {
      let panelRoot = offerListEl;
      for (let i = 0; i < 3 && panelRoot.parentElement; i += 1) {
        panelRoot = panelRoot.parentElement;
      }
      const fromPanel = pickBestImageUrl(collectImageUrls(panelRoot));
      if (fromPanel) {
        imageCandidates.push({ url: fromPanel, source: "panel" });
      }
    }

    if (imageCandidates.length === 0) {
      return "";
    }

    imageCandidates.sort((a, b) => {
      const sourceBonus = (source) => {
        if (source === "html-proximity") {
          return 90;
        }
        if (source === "card") {
          return 35;
        }
        if (source === "detail") {
          return 25;
        }
        return 10;
      };

      return (
        scoreImageUrl(b.url) + sourceBonus(b.source) - (scoreImageUrl(a.url) + sourceBonus(a.source))
      );
    });

    return imageCandidates[0].url;
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

  function listContextText(listEl) {
    if (!listEl) {
      return "";
    }
    const contextRoot =
      listEl.closest("[role='dialog'], [role='complementary'], aside, section") ||
      listEl.parentElement ||
      listEl;
    return clean(contextRoot.textContent || "").slice(0, 3500);
  }

  function offerCandidateSignature(candidate) {
    if (!candidate || !candidate.listEl) {
      return "";
    }

    const topHrefs = Array.from(
      candidate.listEl.querySelectorAll("a[data-hveid][data-ved][href], a[href^='http']")
    )
      .slice(0, 4)
      .map((a) => toAbsUrl(a.getAttribute("href") || a.href || ""))
      .join("|");

    return [
      candidate.dataNtof || "",
      topHrefs,
      clean(candidate.listEl.textContent || "").slice(0, 140),
    ].join("::");
  }

  function isVisible(el) {
    if (!el) {
      return false;
    }
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
  }

  function scoreOfferListCandidates(expectedItemName) {
    const expected = clean(expectedItemName || "").toLowerCase();
    const lists = Array.from(document.querySelectorAll("[role='list']"));
    const candidates = [];

    for (const listEl of lists) {
      const rect = listEl.getBoundingClientRect();
      const visible = isVisible(listEl);
      const dataNtof = dataNtofForList(listEl);
      const firstExternal = firstExternalHrefFromList(listEl);
      const contextText = listContextText(listEl);
      const loweredContext = contextText.toLowerCase();

      let score = 0;
      if (visible) score += 100;
      if (dataNtof) score += 70;
      if (firstExternal) score += 60;
      if (rect.left >= window.innerWidth * 0.35) score += 25;
      score += Math.min(20, Math.max(0, rect.height) / 60);

      if (expected) {
        const expectedSlice = expected.slice(0, 40);
        if (expectedSlice && loweredContext.includes(expectedSlice)) {
          score += 40;
        }
      }

      candidates.push({ listEl, dataNtof, firstExternal, score });
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  async function waitForOfferList(timeoutMs, expectedItemName, previousSignature, requireChange) {
    const deadline = Date.now() + timeoutMs;
    let best = null;

    while (Date.now() < deadline) {
      const candidates = scoreOfferListCandidates(expectedItemName);
      if (candidates.length > 0) {
        const filtered =
          previousSignature && requireChange
            ? candidates.filter((c) => offerCandidateSignature(c) !== previousSignature)
            : candidates;

        best = (filtered.length > 0 ? filtered : candidates)[0];

        const hasSignal = Boolean(best.dataNtof || best.firstExternal);
        if (hasSignal) {
          return best;
        }
      }

      await sleep(jitter(170, 300));
    }

    return best;
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
  const decodedHtml = decodeEmbeddedMarkup(document.documentElement.outerHTML || "");
  const htmlEntries = buildHtmlProximityImageEntries(decodedHtml);
  const htmlEntryLookup = buildHtmlEntryLookupByKey(htmlEntries);

  console.log("Found", allCards.length, "cards. Processing", cards.length);
  console.log("HTML proximity image entry count:", htmlEntries.length);

  const rows = [];

  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    card.scrollIntoView({ block: "center", inline: "nearest" });
    await sleep(jitter(250, 440));

    const itemName = extractItemName(card);
    const itemPrice = extractPrice(card);

    const beforeCtx = await waitForOfferList(1300, itemName, "", false);
    const beforeSignature = offerCandidateSignature(beforeCtx);

    card.click();
    await sleep(jitter(330, 560));

    let offerCtx = await waitForOfferList(9000, itemName, beforeSignature, true);

    if (offerCtx && offerCtx.listEl) {
      await expandOffersList(offerCtx.listEl);
      offerCtx = {
        listEl: offerCtx.listEl,
        dataNtof: dataNtofForList(offerCtx.listEl),
        firstExternal: firstExternalHrefFromList(offerCtx.listEl),
      };
    }

    const itemImg = extractImage(
      card,
      i,
      offerCtx && offerCtx.listEl ? offerCtx.listEl : null,
      htmlEntries,
      htmlEntryLookup
    );
    const itemWebListing =
      (offerCtx && offerCtx.firstExternal) || buildGoogleFallback(itemName);

    rows.push({
      item_name: itemName,
      item_price: itemPrice,
      item_gender: inferGender(itemName),
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