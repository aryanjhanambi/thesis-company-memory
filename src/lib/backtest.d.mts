export type Price = { date: string; ticker: string; close: number };
export type TestInput = {
  prices: Price[];
  tickers: string[];
  benchmark: string;
  asOf: string;
  end: string;
  capital: number;
  costBps: number;
  direction: string;
  root?: string;
};
export type TestResult = {
  curve: { date: string; equity: number; benchmark: number }[];
  trades: {
    date: string;
    ticker: string;
    side: string;
    price: number;
    shares: number;
    fee: number;
  }[];
  totalReturn: number;
  benchmarkReturn: number;
  excessReturn: number;
  maxDrawdown: number;
  entry: string;
  exit: string;
  engineVersion: string;
  assumptions: string;
};
export function validDate(value: unknown): boolean;
export function parsePrices(csv: string): Price[];
export function samplePrices(): Price[];
export function runBacktest(input: TestInput): TestResult;
