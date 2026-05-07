const SYMBOL_MAP = {
  BMW: "BMW.XETRA",
  SAP: "SAP.XETRA",
  ALV: "ALV.XETRA",
  SIE: "SIE.XETRA",
  DTE: "DTE.XETRA",
  MBG: "MBG.XETRA",
  VOW3: "VOW3.XETRA"
};

export default async function handler(req, res) {
  try {
    const requestedSymbol = req.query.symbol || "BMW";
    const eodhdSymbol = SYMBOL_MAP[requestedSymbol] || requestedSymbol;

    const response = await fetch(
      `https://eodhd.com/api/real-time/${encodeURIComponent(eodhdSymbol)}?api_token=${process.env.EODHD_API_KEY}&fmt=json`
    );

    const data = await response.json();

    if (data.error || data.message || data.code) {
      return res.status(200).json({
        requestedSymbol,
        eodhdSymbol,
        supported: false,
        provider: "eodhd",
        error: data.error || data.message || "No quote available",
        raw: data
      });
    }

    const price = data.close || data.previousClose || data.price;

    if (!price || Number(price) === 0) {
      return res.status(200).json({
        requestedSymbol,
        eodhdSymbol,
        supported: false,
        provider: "eodhd",
        error: "No quote available",
        raw: data
      });
    }

    res.status(200).json({
      requestedSymbol,
      eodhdSymbol,
      supported: true,
      provider: "eodhd",
      price: Number(price),
      change: data.change ? Number(data.change) : null,
      changePercent: data.change_p ? Number(data.change_p) : null,
      open: data.open ? Number(data.open) : null,
      high: data.high ? Number(data.high) : null,
      low: data.low ? Number(data.low) : null,
      previousClose: data.previousClose ? Number(data.previousClose) : null,
      timestamp: data.timestamp || null,
      raw: data
    });
  } catch (error) {
    res.status(500).json({
      supported: false,
      provider: "eodhd",
      error: "EODHD quote request failed"
    });
  }
}
