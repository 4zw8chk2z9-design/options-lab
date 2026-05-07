const EODHD_STOCK_MAP = {
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

function getDateString(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
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

  const dailyVol = Math.sqrt(variance);
  const annualizedVol = dailyVol * Math.sqrt(252) * 100;

  return annualizedVol;
}

function normalizeHistory(rows, provider, requestedSymbol, sourceSymbol) {
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
      error: "Not enough historical data",
      count: closes.length
    };
  }

  const high52 = Math.max(...cleaned.map(row => row.high || row.close));
  const low52 = Math.min(...cleaned.map(row => row.low || row.close));
  const lastClose = closes[closes.length - 1];

  const vola30 = calculateHistoricalVolatility(closes, 30);
  const vola90 = calculateHistoricalVolatility(closes, 90);
  const vola52 = calculateHistoricalVolatility(closes, Math.min(252, closes.length - 1));

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

async function fetchEodhdHistory(symbol, requestedSymbol, providerLabel) {
  const from = getDateString(420);
  const to = getDateString(0);

  const url =
    `https://eodhd.com/api/eod/${encodeURIComponent(symbol)}` +
    `?api_token=${process.env.EODHD_API_KEY}&fmt=json&from=${from}&to=${to}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!Array.isArray(data)) {
    return {
      requestedSymbol,
      sourceSymbol: symbol,
      provider: providerLabel,
      supported: false,
      error: data.message || data.error || "No EODHD history available",
      raw: data
    };
  }

  return normalizeHistory(data, providerLabel, requestedSymbol, symbol);
}

async function fetchFinnhubHistory(symbol, requestedSymbol, providerLabel) {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 420 * 24 * 60 * 60;

  const url =
    `https://finnhub.io/api/v1/stock/candle` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&resolution=D&from=${from}&to=${to}` +
    `&token=${process.env.FINNHUB_API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.s !== "ok" || !Array.isArray(data.c)) {
    return {
      requestedSymbol,
      sourceSymbol: symbol,
      provider: providerLabel,
      supported: false,
      error: data.error || "No Finnhub history available",
      raw: data
    };
  }

  const rows = data.c.map((close, i) => ({
    date: new Date(data.t[i] * 1000).toISOString().slice(0, 10),
    open: data.o[i],
    high: data.h[i],
    low: data.l[i],
    close,
    volume: data.v ? data.v[i] : null
  }));

  return normalizeHistory(rows, providerLabel, requestedSymbol, symbol);
}

export default async function handler(req, res) {
  try {
    const requestedSymbol = req.query.symbol || "AAPL";

    if (INDEX_PROXY_MAP[requestedSymbol]) {
      return res.status(200).json(
        await fetchFinnhubHistory(
          INDEX_PROXY_MAP[requestedSymbol],
          requestedSymbol,
          "finnhub-index-proxy"
        )
      );
    }

    if (INDEX_MAP[requestedSymbol]) {
      return res.status(200).json(
        await fetchEodhdHistory(
          INDEX_MAP[requestedSymbol],
          requestedSymbol,
          "eodhd-index"
        )
      );
    }

    if (EODHD_STOCK_MAP[requestedSymbol]) {
      return res.status(200).json(
        await fetchEodhdHistory(
          EODHD_STOCK_MAP[requestedSymbol],
          requestedSymbol,
          "eodhd-stock"
        )
      );
    }

    if (CRYPTO_MAP[requestedSymbol]) {
      return res.status(200).json(
        await fetchEodhdHistory(
          CRYPTO_MAP[requestedSymbol],
          requestedSymbol,
          "eodhd-crypto"
        )
      );
    }

    if (COMMODITY_MAP[requestedSymbol]) {
      return res.status(200).json(
        await fetchFinnhubHistory(
          COMMODITY_MAP[requestedSymbol],
          requestedSymbol,
          "finnhub-commodity-proxy"
        )
      );
    }

    return res.status(200).json(
      await fetchFinnhubHistory(
        requestedSymbol,
        requestedSymbol,
        "finnhub"
      )
    );
  } catch (error) {
    return res.status(500).json({
      supported: false,
      error: "History-smart request failed",
      details: error.message
    });
  }
}
