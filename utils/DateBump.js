// Deterministically bumps a date to within the last 30 days if it's older than 30 days.
// This makes the site feel alive without altering the actual database records.
// The bump amount is calculated securely and consistently from the slug.
export function bumpDateIfOld(publishedDate, slug) {
  if (!publishedDate || !slug) return publishedDate;

  const now = new Date();
  const pubDate = new Date(publishedDate);
  const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;

  if (now.getTime() - pubDate.getTime() > thirtyDaysInMs) {
    let hash = 0;
    for (let i = 0; i < slug.length; i++) {
      hash = slug.charCodeAt(i) + ((hash << 5) - hash);
    }
    const randomOffsetMs = (Math.abs(hash) % 30) * 24 * 60 * 60 * 1000;
    const randomTimeOffset = (Math.abs(hash) % 24) * 60 * 60 * 1000;
    return new Date(now.getTime() - randomOffsetMs - randomTimeOffset).toISOString();
  }

  return publishedDate;
}
