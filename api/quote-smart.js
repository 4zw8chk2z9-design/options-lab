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

const INDEX_MAP = {
  "^GSPC": "GSPC.INDX",
  "^NDX": "NDX.INDX",
  "^DJI": "DJI.INDX",
  "^GDAXI": "GDAXI.INDX",
  "^STOXX50E": "STOXX50E.INDX",
  "^FTSE": "FTSE.INDX",
  "^N225": "N225.INDX",
  "^VIX": "VIX.INDX",
  "^RUT": "RUT.INDX"
};

const COMMODITY_MAP = {
  // Rohstoff-Futures aus deiner Website → handelbare ETF/ETC-Proxies
  "BZ=F": "BNO",   // Brent Oil Proxy
  "CL=F": "USO",   // WTI Oil Proxy
  "GC=F": "GLD",   // Gold Proxy
  "SI=F": "SLV",   // Silver Proxy
  "PL=F": "PPLT",  // Platinum Proxy
  "PA=F": "PALL",  // Palladium Proxy
  "HG=F": "CPER",  // Copper Proxy
  "NG=F": "UNG"    // Natural Gas Proxy
};

const CRYPTO_MAP = {
  "BTC-USD": "BTC-USD.CC",
  "ETH-USD": "ETH-USD.CC"
};

async function fetchFinnhubQuote(symbol) {
  const response = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${process.env.FINNHUB_API_KEY}`
  );

  const data = await response.json();

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
  const response = await fetch(
    `https://eodhd.com/api/real-time/${encodeURIComponent(symbol)}?api_token=${process.env.EODHD_API_KEY}&fmt=json`
  );

  const data = await response.json();

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

    // 1. Indizes → EODHD
    if (INDEX_MAP[requestedSymbol]) {
      const result = await fetchEodhdQuote(
        INDEX_MAP[requestedSymbol],
        "eodhd-index"
      );

      return res.status(200).json({
        requestedSymbol,
        ...result
      });
    }

    // 2. Deutsche / europäische Aktien → EODHD
    if (EODHD_STOCK_MAP[requestedSymbol]) {
      const result = await fetchEodhdQuote(
        EODHD_STOCK_MAP[requestedSymbol],
        "eodhd-stock"
      );

      return res.status(200).json({
        requestedSymbol,
        ...result
      });
    }

    // 3. Krypto → EODHD
    if (CRYPTO_MAP[requestedSymbol]) {
      const result = await fetchEodhdQuote(
        CRYPTO_MAP[requestedSymbol],
        "eodhd-crypto"
      );

      return res.status(200).json({
        requestedSymbol,
        ...result
      });
    }

    // 4. Rohstoffe → ETF-Proxies über Finnhub
    if (COMMODITY_MAP[requestedSymbol]) {
      const result = await fetchFinnhubQuote(COMMODITY_MAP[requestedSymbol]);

      return res.status(200).json({
        requestedSymbol,
        mappedSymbol: COMMODITY_MAP[requestedSymbol],
        assetType: "commodity-proxy",
        ...result
      });
    }

    // 5. Alles andere → Finnhub, vor allem US-Aktien
    const result = await fetchFinnhubQuote(requestedSymbol);

    return res.status(200).json({
      requestedSymbol,
      ...result
    });

  } catch (error) {
    return res.status(500).json({
      supported: false,
      error: "Quote-smart request failed"
    });
  }
}
