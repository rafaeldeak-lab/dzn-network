export function CommsMessageTime({ value }: { value: string | null }) {
  const match = value?.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)(Z|[+-]\d{2}:\d{2})?$/);
  if (!match) return null;

  // SQLite CURRENT_TIMESTAMP has no offset but represents UTC, not browser-local time.
  const date = new Date(`${match[1]}T${match[2]}${match[3] || "Z"}`);
  if (Number.isNaN(date.getTime())) return null;

  const dateTime = date.toISOString();
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

  return (
    <time dateTime={dateTime} title={dateTime} className="text-xs font-semibold text-zinc-500">
      {`${label} UTC`}
    </time>
  );
}
