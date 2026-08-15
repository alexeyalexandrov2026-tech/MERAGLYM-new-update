/**
 * MERAGLYM Confidence Scoring Engine
 * 
 * Mathematical Formulation:
 * -------------------------------------------------------------
 * Confidence = (w_rel * Reliability) + (w_fresh * Freshness) + (w_corrob * Corroboration) + (w_parser * ParserConf)
 * 
 * Weights (Sum = 1.0):
 * - w_rel    = 0.40 (Source Authority & Official Registry status)
 * - w_fresh  = 0.20 (Observation age decay factor)
 * - w_corrob = 0.25 (Cross-adapter corroboration count)
 * - w_parser = 0.15 (Regex / format / checksum validation confidence)
 * -------------------------------------------------------------
 */

export interface ConfidenceFactors {
  sourceReliability: number; // 0.0 to 1.0 (e.g., FNS/EGRUL = 0.95, Social Scraper = 0.60)
  observedAt?: string | Date; // Date of observation for freshness calculation
  corroborationCount?: number; // Number of independent sources confirming the entity
  parserConfidence?: number; // 0.0 to 1.0 (e.g. Luhn/INN checksum pass = 1.0)
}

export function calculateConfidence(factors: ConfidenceFactors): number | null {
  if (factors.sourceReliability == null || isNaN(factors.sourceReliability)) {
    return null;
  }

  const rel = Math.max(0, Math.min(1, factors.sourceReliability));
  const parser = Math.max(0, Math.min(1, factors.parserConfidence ?? 0.8));

  // Freshness calculation (Decay over 365 days)
  let freshness = 0.9;
  if (factors.observedAt) {
    const ageMs = Date.now() - new Date(factors.observedAt).getTime();
    const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));
    freshness = Math.max(0.1, 1 - (ageDays / 365) * 0.5);
  }

  // Corroboration score (Logarithmic scaling capped at 5 sources)
  const count = Math.max(1, factors.corroborationCount ?? 1);
  const corroboration = Math.min(1.0, 0.5 + Math.log2(count) * 0.2);

  const score = (0.40 * rel) + (0.20 * freshness) + (0.25 * corroboration) + (0.15 * parser);
  return Math.round(score * 100) / 100;
}
