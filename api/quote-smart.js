const EODHD_STOCK_MAP = {
  BMW: "BMW.XETRA",
  SAP: "SAP.XETRA",
  ALV: "ALV.XETRA",
  SIE: "SIE.XETRA",
  DTE: "DTE.XETRA",
  MBG: "MBG.XETRA",
  VOW3: "VOW3.XETRA"
};

const INDEX_MAP = {
  "^GSPC": "GSPC.INDX",
  "^NDX": "NDX.INDX",
  "^DJI": "DJI.INDX",
  "^GDAXI": "GDAXI.INDX",
  "^STOXX50E": "STOXX50E.INDX",
  "^FTSE": "FTSE.INDX"
};

const COMMODITY_MAP = {
  "GC=F": "GLD",
  "SI=F": "SLV",
  "CL=F": "USO",
  "BZ=F": "BNO"
};

const FINNHUB_TICKERS = [
  "AAPL","MSFT","NVDA","TSLA","GOOGL","META","AMZN",
  "NFLX","AMD","INTC","CRM","ORCL","ADBE",
  "GLD","SLV","USO","BNO"
];

export default async function handler(req, res) {
  try {
    const symbol = req.query.symbol || "AAPL";
const mappedCommodity = COMMODITY_MAP[symbol];
const finalSymbol = mappedCommodity || symbol;
    
    // 1. US Aktien + Rohstoff ETFs → Finnhub
 if (FINNHUB_TICKERS.includes(finalSymbol)) {
      const response = await fetch(
  `https://finnhub.io/api/v1/quote?symbol=${finalSymbol}&token=${process.env.FINNHUB_API_KEY}`
      );
      const data = await response.json();

      if (!data.c) {
        return res.status(200).json({ supported: false });
      }

      return res.status(200).json({
        supported: true,
        provider: "finnhub",
        price: data.c,
        change: data.d,
        changePercent: data.dp
      });
    }

    // 2. Indizes → EODHD
    if (INDEX_MAP[symbol]) {
      const eodSymbol = INDEX_MAP[symbol];

      const response = await fetch(
        `https://eodhd.com/api/real-time/${eodSymbol}?api_token=${process.env.EODHD_API_KEY}&fmt=json`
      );
      const data = await response.json();

      return res.status(200).json({
        supported: true,
        provider: "eodhd-index",
        price: data.close,
        change: data.change,
        changePercent: data.change_p
      });
    }

    // 3. DAX / EU Aktien → EODHD
    if (EODHD_STOCK_MAP[symbol]) {
      const eodSymbol = EODHD_STOCK_MAP[symbol];

      const response = await fetch(
        `https://eodhd.com/api/real-time/${eodSymbol}?api_token=${process.env.EODHD_API_KEY}&fmt=json`
      );
      const data = await response.json();

      return res.status(200).json({
        supported: true,
        provider: "eodhd-stock",
        price: data.close,
        change: data.change,
        changePercent: data.change_p
      });
    }

    // fallback
    return res.status(200).json({
      supported: false
    });

  } catch (error) {
    return res.status(500).json({
      supported: false
    });
  }
}
