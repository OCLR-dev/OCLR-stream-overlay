// Presentation-only interpolation. The target always remains the exact shared
// score; no intermediate value is ever used for results or match automation.
export const parseCounterScore = (text: string) => {
  if (!/^\d+(?:,\d+)*$/.test(text)) return null;
  const value = Number(text.replaceAll(',', ''));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
};
export function formatCounterScore(value: number, target: string) {
  const digits = String(Math.floor(value));
  const group = target.includes(',') ? target.split(',').at(-1)!.length : 0;
  return group ? digits.replace(new RegExp(`\\B(?=(\\d{${group}})+(?!\\d))`, 'g'), ',') : digits;
}
export class ScoreCounter {
  value: number | null = null;
  target: number | null = null;
  private from = 0;
  private started = 0;
  private active = false;
  // Retarget from the number currently on screen, never queue old updates.
  update(target: number | null, now: number, animate: boolean) {
    if (!animate || target === null || this.value === null || this.target === null || target < this.target) {
      this.value = target; this.target = target; this.active = false; return;
    }
    if (target === this.target) return;
    this.from = this.value; this.started = now; this.target = target; this.active = true;
  }
  tick(now: number) {
    if (!this.active || this.target === null) return false;
    const progress = Math.min(1, Math.max(0, (now - this.started) / 120));
    this.value = progress === 1 ? this.target : this.from + (this.target - this.from) * progress;
    this.active = progress < 1;
    return this.active;
  }
}
