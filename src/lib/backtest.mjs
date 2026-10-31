const fail = (message) => {
  throw Object.assign(new Error(message), { status: 400 });
};
export function validDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function parsePrices(csv) {
  if (typeof csv !== 'string' || csv.length > 700000) fail('Upload a CSV smaller than 700 KB.');
  const lines = csv.trim().split(/\r?\n/);
  if (lines.shift()?.trim().toLowerCase() !== 'date,ticker,close')
    fail('CSV header must be date,ticker,close. Use consistently adjusted closing prices.');
  return validatePrices(
    lines
      .filter((l) => l.trim())
      .map((line) => {
        const parts = line.trim().split(',');
        if (parts.length !== 3) fail('Each CSV row needs exactly three unquoted fields.');
        return {
          date: parts[0].trim(),
          ticker: parts[1].trim().toUpperCase(),
          close: Number(parts[2]),
        };
      }),
  );
}
export function validatePrices(prices) {
  if (!Array.isArray(prices) || prices.length < 4 || prices.length > 10000)
    fail('Provide 4–10,000 price rows.');
  const seen = new Set();
  for (const row of prices) {
    if (
      !validDate(row?.date) ||
      !/^[A-Z][A-Z0-9.-]{0,9}$/.test(row?.ticker) ||
      !Number.isFinite(row?.close) ||
      row.close <= 0
    )
      fail('Each price needs an ISO date, ticker and positive numeric close.');
    const key = `${row.date}:${row.ticker}`;
    if (seen.has(key)) fail(`Duplicate price for ${key}.`);
    seen.add(key);
  }
  return prices;
}
export function runBacktest(input) {
  const {
    prices,
    tickers,
    benchmark = 'SPY',
    asOf,
    end,
    capital = 10000,
    costBps = 10,
    direction = 'long',
  } = input || {};
  validatePrices(prices);
  if (
    !Array.isArray(tickers) ||
    !tickers.length ||
    tickers.length > 6 ||
    new Set(tickers).size !== tickers.length ||
    tickers.some((t) => !/^[A-Z][A-Z0-9.-]{0,9}$/.test(t))
  )
    fail('Select 1–6 distinct company tickers.');
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(benchmark) || tickers.includes(benchmark))
    fail('Use a separate benchmark ticker.');
  if (!validDate(asOf) || !validDate(end) || end <= asOf)
    fail('End date must be after the evidence cutoff.');
  if (
    !Number.isFinite(capital) ||
    capital < 100 ||
    capital > 10000000 ||
    !Number.isFinite(costBps) ||
    costBps < 0 ||
    costBps > 500
  )
    fail('Capital must be $100–$10m; costs must be 0–500 bps.');
  if (!['long', 'cash'].includes(direction))
    fail('Choose long basket or stay in cash. Shorting is not modeled.');
  const universe = [...tickers, benchmark];
  const dates = [
    ...new Set(
      prices
        .filter((p) => universe.includes(p.ticker) && p.date > asOf && p.date <= end)
        .map((p) => p.date),
    ),
  ].sort();
  if (dates.length < 2) fail('Need at least two price dates strictly after the cutoff.');
  const lookup = new Map(prices.map((p) => [`${p.date}:${p.ticker}`, p.close]));
  for (const date of dates)
    for (const ticker of universe)
      if (!lookup.has(`${date}:${ticker}`))
        fail(
          `Missing ${ticker} on ${date}. Align all series; missing days are not silently dropped.`,
        );
  const entry = dates[0],
    exit = dates.at(-1),
    fee = costBps / 10000;
  const invested = direction === 'long' ? capital / (1 + fee) : 0;
  const positions = tickers.map((ticker) => ({
    ticker,
    shares: invested / tickers.length / lookup.get(`${entry}:${ticker}`),
  }));
  const benchmarkShares = capital / (1 + fee) / lookup.get(`${entry}:${benchmark}`);
  const trades =
    direction === 'long'
      ? positions
          .flatMap((p) => [
            {
              date: entry,
              ticker: p.ticker,
              side: 'BUY',
              price: lookup.get(`${entry}:${p.ticker}`),
              shares: p.shares,
              fee: p.shares * lookup.get(`${entry}:${p.ticker}`) * fee,
            },
            {
              date: exit,
              ticker: p.ticker,
              side: 'SELL',
              price: lookup.get(`${exit}:${p.ticker}`),
              shares: p.shares,
              fee: p.shares * lookup.get(`${exit}:${p.ticker}`) * fee,
            },
          ])
          .sort((a, b) => a.date.localeCompare(b.date))
      : [];
  const curve = [
    { date: asOf, equity: capital, benchmark: capital },
    ...dates.map((date) => {
      const liquidation = date === exit ? 1 - fee : 1;
      return {
        date,
        equity:
          direction === 'cash'
            ? capital
            : positions.reduce((v, p) => v + p.shares * lookup.get(`${date}:${p.ticker}`), 0) *
              liquidation,
        benchmark: benchmarkShares * lookup.get(`${date}:${benchmark}`) * liquidation,
      };
    }),
  ];
  let peak = capital,
    maxDrawdown = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.equity);
    maxDrawdown = Math.min(maxDrawdown, p.equity / peak - 1);
  }
  const totalReturn = curve.at(-1).equity / capital - 1,
    benchmarkReturn = curve.at(-1).benchmark / capital - 1;
  return {
    curve,
    trades,
    totalReturn,
    benchmarkReturn,
    excessReturn: totalReturn - benchmarkReturn,
    maxDrawdown,
    entry,
    exit,
    engineVersion: 'buy-hold-v1',
    assumptions:
      'Equal initial dollar weights; fractional shares; buy first close strictly after cutoff; hold without rebalancing; liquidate last close; costs on both sides for strategy and benchmark. Cash earns 0%. No taxes, dividends, borrow, liquidity or market impact model. Corporate actions depend on your adjusted input.',
  };
}
export function samplePrices() {
  // Deliberately fabricated deterministic series for exercising the engine only.
  const names = ['MSFT', 'AMZN', 'NVDA', 'TSM', 'DELL', 'SMCI', 'SPY'];
  const rows = [];
  for (let d = 0; d < 95; d++) {
    const day = new Date(Date.UTC(2024, 2, 18 + d));
    if ([0, 6].includes(day.getUTCDay())) continue;
    names.forEach((ticker, i) =>
      rows.push({
        date: day.toISOString().slice(0, 10),
        ticker,
        close: +(
          100 *
          Math.exp(
            0.0005 * d +
              0.035 * Math.sin(d / 7 + i) -
              (i > 1 && i < 6 ? 0.0015 * Math.max(0, d - 28) : 0),
          )
        ).toFixed(4),
      }),
    );
  }
  return rows;
}
