/// <reference types="vite/client" />
declare module '*.mjs' {
  export function extractClaims(text: string): { id: string; text: string; category: string }[];
  export function compareClaims(
    before: { text: string; category: string }[],
    after: { text: string; category: string }[],
  ): {
    added: { text: string; category: string }[];
    removed: { text: string; category: string }[];
    unchanged: { text: string; category: string }[];
  };
  export function findEvidence(
    question: string,
    reports: { id: string; period: string; text: string }[],
  ): { text: string; category: string; reportId: string; period: string; score: number }[];
}
