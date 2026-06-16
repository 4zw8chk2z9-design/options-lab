const EODHD_STOCK_MAP = {
  // Deutschland / Xetra
  "SAP.DE": "SAP.XETRA",
  "SIE.DE": "SIE.XETRA",
  "ALV.DE": "ALV.XETRA",
  "BMW.DE": "BMW.XETRA",
  "VOW3.DE": "VOW3.XETRA",
  "BAS.DE": "BAS.XETRA",
  "DTE.DE": "DTE.XETRA",
  "MBG.DE": "MBG.XETRA",
  "DBK.DE": "DBK.XETRA",
  "IFX.DE": "IFX.XETRA",
  "ADS.DE": "ADS.XETRA",
  "AIR.DE": "AIR.XETRA",

  // Europa
  "ASML.AS": "ASML.AS",
  "LVMH.PA": "MC.PA",
  "NESN.SW": "NESN.SW",
  "NOVN.SW": "NOVN.SW",
  "TTE.PA": "TTE.PA"
};

const INDEX_PROXY_MAP = {
  "^FTSE": "EWU",
  "^RUT": "IWM"
};

const INDEX_MAP = {
  "^GSPC": "GSPC.INDX",
  "^NDX": "NDX.INDX",
  "^DJI": "DJI.INDX",
  "^GDAXI": "GDAXI.INDX",
  "^STOXX50E": "STOXX50E.INDX",
  "^N225": "N225.INDX",
  "^VIX": "VIX.INDX"
};

const COMMODITY_MAP = {
  "BZ=F": "BNO",
  "CL=F": "USO",
  "GC=F": "GLD",
  "SI=F": "SLV",
  "PL=F": "PPLT",
  "PA=F": "PALL",
  "HG=F": "CPER",
  "NG=F": "UNG"
};

const CRYPTO_MAP = {
  "BTC-USD": "BTC-USD.CC",
  "ETH-USD": "ETH-USD.CC"
};

// ---- Server-seitiger In-Memory-Cache (pro Function-Instanz) ----
// Live-Kurse: 90 Sek TTL -> nicht jeder Seitenaufruf verbrennt das Kontingent.
const QUOTE_TTL_MS = 90 * 1000;
const quoteCache = new Map(); // requestedSymbol -> { ts, payload }

// ---- Robuste externe Antwort-Verarbeitung ----
// Body genau EINMAL als Text lesen, Status/Content-Type prüfen und
// Rate-Limit-/Klartext-Antworten abfangen, BEVOR JSON.parse läuft.
async function safeFetchJson(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (e) {
    return { ok: false, reason: "network_error", status: 0, snippet: String(e && e.message || e).slice(0, 160) };
  }

  const status = response.status;
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const rawText = await response.text();

  if (status === 429 || /you exceeded|rate limit|too many requests|limit reached|quota/i.test(rawText)) {
    return { ok: false, reason: "rate_limited", status, snippet: rawText.slice(0, 160) };
  }

  if (!response.ok) {
    return { ok: false, reason: "upstream_error", status, snippet: rawText.slice(0, 160) };
  }

  if (contentType && !contentType.includes("json") && !contentType.includes("text/plain")) {
    return { ok: false, reason: "non_json", status, snippet: rawText.slice(0, 160) };
  }

  try {
    return { ok: true, data: JSON.parse(rawText), status };
  } catch (parseError) {
    return { ok: false, reason: "non_json", status, snippet: rawText.slice(0, 160) };
  }
}

async function fetchFinnhubQuote(symbol) {
  const fetched = await safeFetchJson(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${process.env.FINNHUB_API_KEY}`
  );

  if (!fetched.ok) {
    return {
      supported: false,
      provider: "finnhub",
      sourceSymbol: symbol,
      reason: fetched.reason,
      error: fetched.reason === "rate_limited" ? "Finnhub rate limit reached" : "No Finnhub quote available",
      details: fetched.snippet
    };
  }

  const data = fetched.data;

  if (data.error || !data.c || Number(data.c) === 0) {
    return {
      supported: false,
      provider: "finnhub",
      sourceSymbol: symbol,
      error: data.error || "No Finnhub quote available",
      raw: data
    };
  }

  return {
    supported: true,
    provider: "finnhub",
    sourceSymbol: symbol,
    price: Number(data.c),
    change: data.d !== undefined ? Number(data.d) : null,
    changePercent: data.dp !== undefined ? Number(data.dp) : null,
    open: data.o !== undefined ? Number(data.o) : null,
    high: data.h !== undefined ? Number(data.h) : null,
    low: data.l !== undefined ? Number(data.l) : null,
    previousClose: data.pc !== undefined ? Number(data.pc) : null,
    timestamp: data.t || null,
    raw: data
  };
}

async function fetchEodhdQuote(symbol, providerLabel) {
  const fetched = await safeFetchJson(
    `https://eodhd.com/api/real-time/${encodeURIComponent(symbol)}?api_token=${process.env.EODHD_API_KEY}&fmt=json`
  );

  if (!fetched.ok) {
    return {
      supported: false,
      provider: providerLabel,
      sourceSymbol: symbol,
      reason: fetched.reason,
      error: fetched.reason === "rate_limited" ? "EODHD rate limit / quota reached" : "No EODHD quote available",
      details: fetched.snippet
    };
  }

  const data = fetched.data;

  if (data.error || data.message) {
    return {
      supported: false,
      provider: providerLabel,
      sourceSymbol: symbol,
      error: data.error || data.message || "No EODHD quote available",
      raw: data
    };
  }

  const price = data.close || data.price || data.previousClose;

  if (!price || Number(price) === 0) {
    return {
      supported: false,
      provider: providerLabel,
      sourceSymbol: symbol,
      error: "No EODHD quote available",
      raw: data
    };
  }

  return {
    supported: true,
    provider: providerLabel,
    sourceSymbol: symbol,
    price: Number(price),
    change: data.change !== undefined ? Number(data.change) : null,
    changePercent: data.change_p !== undefined ? Number(data.change_p) : null,
    open: data.open !== undefined ? Number(data.open) : null,
    high: data.high !== undefined ? Number(data.high) : null,
    low: data.low !== undefined ? Number(data.low) : null,
    previousClose: data.previousClose !== undefined ? Number(data.previousClose) : null,
    timestamp: data.timestamp || null,
    raw: data
  };
}

export default async function handler(req, res) {
  try {
    const requestedSymbol = req.query.symbol || "AAPL";

    // 0. Cache-Treffer? -> Kontingent schonen
    const cached = quoteCache.get(requestedSymbol);
    if (cached && (Date.now() - cached.ts) < QUOTE_TTL_MS) {
      return res.status(200).json({ ...cached.payload, cached: true });
    }

    let payload;

    // 1. Index-Proxies über Finnhub
    if (INDEX_PROXY_MAP[requestedSymbol]) {
      const result = await fetchFinnhubQuote(INDEX_PROXY_MAP[requestedSymbol]);
      payload = {
        requestedSymbol,
        mappedSymbol: INDEX_PROXY_MAP[requestedSymbol],
        assetType: "index-proxy",
        ...result
      };
    }
    // 2. Indizes über EODHD
    else if (INDEX_MAP[requestedSymbol]) {
      const result = await fetchEodhdQuote(INDEX_MAP[requestedSymbol], "eodhd-index");
      payload = { requestedSymbol, ...result };
    }
    // 3. Deutsche / europäische Aktien über EODHD
    else if (EODHD_STOCK_MAP[requestedSymbol]) {
      const result = await fetchEodhdQuote(EODHD_STOCK_MAP[requestedSymbol], "eodhd-stock");
      payload = { requestedSymbol, ...result };
    }
    // 4. Krypto über EODHD
    else if (CRYPTO_MAP[requestedSymbol]) {
      const result = await fetchEodhdQuote(CRYPTO_MAP[requestedSymbol], "eodhd-crypto");
      payload = { requestedSymbol, ...result };
    }
    // 5. Rohstoffe über ETF-Proxies via Finnhub
    else if (COMMODITY_MAP[requestedSymbol]) {
      const result = await fetchFinnhubQuote(COMMODITY_MAP[requestedSymbol]);
      payload = {
        requestedSymbol,
        mappedSymbol: COMMODITY_MAP[requestedSymbol],
        assetType: "commodity-proxy",
        ...result
      };
    }
    // 6. Alles andere über Finnhub, vor allem US-Aktien
    else {
      const result = await fetchFinnhubQuote(requestedSymbol);
      payload = { requestedSymbol, ...result };
    }

    // Nur erfolgreiche Kurse cachen (keine Fehl-/Rate-Limit-Antworten)
    if (payload.supported) {
      quoteCache.set(requestedSymbol, { ts: Date.now(), payload });
    }

    return res.status(200).json(payload);
  } catch (error) {
    return res.status(500).json({
      supported: false,
      error: "Quote-smart request failed",
      details: error.message
    });
  }
}
