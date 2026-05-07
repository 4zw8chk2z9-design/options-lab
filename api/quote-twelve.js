export default async function handler(req, res) {
  try {
    const requestedSymbol = req.query.symbol || "AAPL";

    const response = await fetch(
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(requestedSymbol)}&apikey=${process.env.TWELVE_DATA_API_KEY}`
    );

    const data = await response.json();

    if (data.status === "error" || data.code) {
      return res.status(200).json({
        requestedSymbol,
        supported: false,
        provider: "twelvedata",
        error: data.message || "No quote available",
        raw: data
      });
    }

    res.status(200).json({
      requestedSymbol,
      supported: true,
      provider: "twelvedata",
      price: data.close,
      change: data.change,
      changePercent: data.percent_change,
      open: data.open,
      high: data.high,
      low: data.low,
      previousClose: data.previous_close,
      currency: data.currency,
      exchange: data.exchange,
      raw: data
    });
  } catch (error) {
    res.status(500).json({
      supported: false,
      provider: "twelvedata",
      error: "Twelve Data quote request failed"
    });
  }
}
