/**
 * Convert a snake_case identifier from the backend's schema inference
 * into a human-readable Title Case label for display. Identical to
 * the dashboard's transform at `frontend/app/dataset/new/page.tsx:139-143`.
 *
 *   nhl_teams_and_head_coaches → "Nhl Teams And Head Coaches"
 *   yc_hiring_startups          → "Yc Hiring Startups"
 */
export function snakeToTitleCase(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
