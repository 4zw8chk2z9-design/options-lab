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
  "^FTSE": "EWU.US",
  "^RUT": "IWM.US"
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
  "BZ=F": "BNO.US",
  "CL=F": "USO.US",
  "GC=F": "GLD.US",
  "SI=F": "SLV.US",
  "PL=F": "PPLT.US",
  "PA=F": "PALL.US",
  "HG=F": "CPER.US",
  "NG=F": "UNG.US"
};

const CRYPTO_MAP = {
  "BTC-USD": "BTC-USD.CC",
  "ETH-USD": "ETH-USD.CC"
};

// ---- Server-seitiger In-Memory-Cache (pro Function-Instanz) ----
// History ändert sich nur einmal täglich -> 45 Min TTL schont das EODHD-Kontingent.
const HISTORY_TTL_MS = 45 * 60 * 1000;
const historyCache = new Map(); // requestedSymbol -> { ts, payload }

function getDateString(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function toEodhdSymbol(symbol) {
  if (INDEX_PROXY_MAP[symbol]) return INDEX_PROXY_MAP[symbol];
  if (INDEX_MAP[symbol]) return INDEX_MAP[symbol];
  if (EODHD_STOCK_MAP[symbol]) return EODHD_STOCK_MAP[symbol];
  if (COMMODITY_MAP[symbol]) return COMMODITY_MAP[symbol];
  if (CRYPTO_MAP[symbol]) return CRYPTO_MAP[symbol];

  // US Aktien ohne Suffix → .US
  if (/^[A-Z]{1,5}$/.test(symbol)) {
    return `${symbol}.US`;
  }

  return symbol;
}

// ---- Robuste externe Antwort-Verarbeitung ----
// Liest den Body genau EINMAL als Text, prüft Status/Content-Type und
// erkennt Rate-Limit-/Klartext-Antworten, BEVOR JSON.parse aufgerufen wird.
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

  // Rate-Limit erkennen: HTTP 429 oder typische Klartext-Marker ("You exceeded...")
  if (status === 429 || /you exceeded|rate limit|too many requests|limit reached|quota/i.test(rawText)) {
    return { ok: false, reason: "rate_limited", status, snippet: rawText.slice(0, 160) };
  }

  if (!response.ok) {
    return { ok: false, reason: "upstream_error", status, snippet: rawText.slice(0, 160) };
  }

  // Nicht-JSON-Antwort (z. B. HTML-Fehlerseite oder Klartext) sauber abfangen
  if (contentType && !contentType.includes("json") && !contentType.includes("text/plain")) {
    return { ok: false, reason: "non_json", status, snippet: rawText.slice(0, 160) };
  }

  try {
    return { ok: true, data: JSON.parse(rawText), status };
  } catch (parseError) {
    return { ok: false, reason: "non_json", status, snippet: rawText.slice(0, 160) };
  }
}

function calculateHistoricalVolatility(closes, days = 30) {
  if (!closes || closes.length < days + 1) return null;

  const recent = closes.slice(-days - 1);
  const returns = [];

  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1];
    const curr = recent[i];

    if (prev > 0 && curr > 0) {
      returns.push(Math.log(curr / prev));
    }
  }

  if (returns.length < 2) return null;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) /
    (returns.length - 1);

  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function normalizeHistory(rows, requestedSymbol, sourceSymbol, provider) {
  // Defensive: nur Arrays sind gültige Kursreihen. Fehler-Objekte o. Ä. sauber abfangen.
  if (!Array.isArray(rows)) {
    return {
      requestedSymbol,
      sourceSymbol,
      provider,
      supported: false,
      reason: "no_data",
      error: "Provider returned no time series"
    };
  }

  const cleaned = rows
    .map(row => ({
      date: row.date,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: row.volume !== undefined ? Number(row.volume) : null
    }))
    .filter(row =>
      row.date &&
      Number.isFinite(row.close) &&
      row.close > 0
    )
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const closes = cleaned.map(row => row.close);

  if (closes.length < 30) {
    return {
      requestedSymbol,
      sourceSymbol,
      provider,
      supported: false,
      reason: "insufficient_data",
      error: "Not enough historical data",
      count: closes.length
    };
  }

  const high52 = Math.max(...cleaned.map(row => row.high || row.close));
  const low52 = Math.min(...cleaned.map(row => row.low || row.close));
  const lastClose = closes[closes.length - 1];

  const vola30 = calculateHistoricalVolatility(closes, 30);
  const vola90 = calculateHistoricalVolatility(closes, 90);
  const vola52 = calculateHistoricalVolatility(
    closes,
    Math.min(252, closes.length - 1)
  );

  return {
    requestedSymbol,
    sourceSymbol,
    provider,
    supported: true,
    count: cleaned.length,
    lastClose,
    high52,
    low52,
    vola30,
    vola90,
    vola52,
    closes,
    history: cleaned
  };
}

export default async function handler(req, res) {
  try {
    const requestedSymbol = req.query.symbol || "AAPL";

    // 1. Cache-Treffer? -> Kontingent schonen
    const cached = historyCache.get(requestedSymbol);
    if (cached && (Date.now() - cached.ts) < HISTORY_TTL_MS) {
      return res.status(200).json({ ...cached.payload, cached: true });
    }

    const sourceSymbol = toEodhdSymbol(requestedSymbol);

    const from = getDateString(420);
    const to = getDateString(0);

    const url =
      `https://eodhd.com/api/eod/${encodeURIComponent(sourceSymbol)}` +
      `?api_token=${process.env.EODHD_API_KEY}&fmt=json&from=${from}&to=${to}`;

    const fetched = await safeFetchJson(url);

    // 2. Externe Antwort abgesichert: Rate-Limit / Nicht-JSON sauber zurückgeben statt crashen
    if (!fetched.ok) {
      return res.status(200).json({
        requestedSymbol,
        sourceSymbol,
        provider: "eodhd-history",
        supported: false,
        reason: fetched.reason,
        error:
          fetched.reason === "rate_limited"
            ? "Provider rate limit / quota reached"
            : "Provider returned no valid data",
        details: fetched.snippet
      });
    }

    const payload = normalizeHistory(
      fetched.data,
      requestedSymbol,
      sourceSymbol,
      "eodhd-history"
    );

    // 3. Nur valide Kursreihen cachen
    if (payload.supported) {
      historyCache.set(requestedSymbol, { ts: Date.now(), payload });
    }

    return res.status(200).json(payload);
  } catch (error) {
    return res.status(500).json({
      supported: false,
      error: "History-smart request failed",
      details: error.message
    });
  }
}
