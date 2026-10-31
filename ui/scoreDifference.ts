// Fixed display scale: 250,000 points fills the 620px half-track. Equal score
// differences always have equal lengths, regardless of the teams' total scores.
const FULL_SCALE_DIFFERENCE = 250_000;

export function scoreDifference(left: string, right: string) {
  const parse = (value: string) => {
    const raw = value.replaceAll(',', '').trim();
    const score = Number(raw);
    return /^\d+$/.test(raw) && Number.isSafeInteger(score) ? score : null;
  };
  const a = parse(left);
  const b = parse(right);
  if (a === null || b === null) return { delta: null, scale: 0 };
  const delta = a - b;
  const scale = Math.max(-1, Math.min(1, -delta / FULL_SCALE_DIFFERENCE));
  return { delta, scale: scale === 0 ? 0 : scale };
}
