/** Parse explicit runtime units or a clock duration; bare numbers need a known unit. */
export function runtimeMinutes(raw: string): number | undefined {
  const text = raw.trim();
  if (!text || /\b(each|per disc|days?)\b/i.test(text)) return undefined;
  const clock = text.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (clock) {
    if (Number(clock[2]) >= 60 || Number(clock[3] ?? 0) >= 60) return undefined;
    const value = Number(clock[1]) * 60 + Number(clock[2]) + Number(clock[3] ?? 0) / 60;
    return value > 0 ? value : undefined;
  }
  const hours = text.match(/(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?\s*(?:hours?|hrs?|h)\b/i);
  const minutes = text.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/i);
  const value = (hours ? (Number(hours[1]) + (hours[2] && Number(hours[3]) ? Number(hours[2]) / Number(hours[3]) : 0)) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
