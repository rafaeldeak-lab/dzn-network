export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("en-GB").format(Number(value ?? 0));
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";
  return new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function relativeTimeLabel(value: string | null | undefined, nowMs: number) {
  if (!value) return "TBD";
  const target = new Date(value).getTime();
  if (!Number.isFinite(target)) return "TBD";
  const diff = target - nowMs;
  const absolute = Math.abs(diff);
  const days = Math.floor(absolute / 86400000);
  const hours = Math.floor((absolute % 86400000) / 3600000);
  const minutes = Math.floor((absolute % 3600000) / 60000);
  const label = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return diff >= 0 ? label : `${label} ago`;
}

export function eventImageStyle(url: string | null | undefined) {
  return {
    backgroundImage: `linear-gradient(180deg, rgba(2,6,23,0.08), rgba(2,6,23,0.42) 46%, rgba(2,6,23,0.94)), url(${url || "/media/dzn-cinematic-survivor.png"})`,
  };
}
