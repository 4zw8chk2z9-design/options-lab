const SYMBOL_MAP = {
  AAPL: "AAPL",
  MSFT: "MSFT",
  NVDA: "NVDA",
  TSLA: "TSLA",
  GOOGL: "GOOGL",
  META: "META",
  AMZN: "AMZN",
  NFLX: "NFLX",
  AMD: "AMD",
  INTC: "INTC",
  CRM: "CRM",
  ORCL: "ORCL",
  ADBE: "ADBE"
};

export default async function handler(req, res) {
  try {
    const requestedSymbol = req.query.symbol || "AAPL";
    const finnhubSymbol = SYMBOL_MAP[requestedSymbol] || requestedSymbol;

    const response = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSymbol)}&token=${process.env.FINNHUB_API_KEY}`
    );

    const data = await response.json();

    if (data.error) {
      return res.status(200).json({
        requestedSymbol,
        finnhubSymbol,
        supported: false,
        error: data.error
      });
    }

    if (!data.c || data.c === 0) {
      return res.status(200).json({
        requestedSymbol,
        finnhubSymbol,
        supported: false,
        error: "No live quote available"
      });
    }

    res.status(200).json({
      requestedSymbol,
      finnhubSymbol,
      supported: true,
      ...data
    });
  } catch (error) {
    res.status(500).json({
      supported: false,
      error: "Quote request failed"
    });
  }
}
