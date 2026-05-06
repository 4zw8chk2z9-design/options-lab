const SYMBOL_MAP = {
  BMW: "BMW.DE",
  SAP: "SAP.DE",
  SIE: "SIE.DE",
  ALV: "ALV.DE",
  DTE: "DTE.DE",
  MBG: "MBG.DE",
  VOW3: "VOW3.DE"
};

export default async function handler(req, res) {
  try {
    const requestedSymbol = req.query.symbol || "AAPL";
    const finnhubSymbol = SYMBOL_MAP[requestedSymbol] || requestedSymbol;

    const response = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSymbol)}&token=${process.env.FINNHUB_API_KEY}`
    );

    const data = await response.json();

    res.status(200).json({
      requestedSymbol,
      finnhubSymbol,
      ...data
    });
  } catch (error) {
    res.status(500).json({
      error: "Quote request failed"
    });
  }
}
