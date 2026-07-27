export type CalendarGameLike = {
  id: number;
  starts_at?: string | null;
  status?: string | null;
  archived_at?: string | null;
};

const londonTimeZone = "Europe/London";

const londonDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: londonTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const calendarLabelFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
});

const calendarDayFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
});

function parseDateKey(dateKey: string) {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return Number.isNaN(date.getTime()) ? null : date;
}

export function getLondonDateKey(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return londonDateFormatter.format(date);
}

export function addDaysToDateKey(dateKey: string, days: number) {
  const date = parseDateKey(dateKey);

  if (!date) {
    return dateKey;
  }

  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

export function getWeekDateKeys(startDateKey: string) {
  return Array.from({ length: 7 }, (_, index) => addDaysToDateKey(startDateKey, index));
}

export function getTodayLondonDateKey(now = new Date()) {
  return getLondonDateKey(now) ?? now.toISOString().slice(0, 10);
}

export function formatCalendarDateLabel(dateKey: string) {
  const date = parseDateKey(dateKey);

  return date ? calendarLabelFormatter.format(date) : dateKey;
}

export function formatCalendarDayNumber(dateKey: string) {
  const date = parseDateKey(dateKey);

  return date ? calendarDayFormatter.format(date) : dateKey;
}

export function isCalendarCountableGame(game: CalendarGameLike) {
  return game.status === "active" && !game.archived_at && Boolean(game.starts_at);
}

export function getGameLondonDateKey(game: CalendarGameLike) {
  return isCalendarCountableGame(game) ? getLondonDateKey(game.starts_at) : null;
}

export function sortGamesByStartsAt<T extends CalendarGameLike>(games: T[]) {
  return [...games].sort((a, b) => {
    const aTime = a.starts_at ? new Date(a.starts_at).getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.starts_at ? new Date(b.starts_at).getTime() : Number.POSITIVE_INFINITY;

    return aTime - bTime;
  });
}

export function getDefaultSelectedDateKey(
  games: CalendarGameLike[],
  now = new Date()
) {
  const todayKey = getTodayLondonDateKey(now);
  const countableDateKeys = games
    .map((game) => getGameLondonDateKey(game))
    .filter((dateKey): dateKey is string => Boolean(dateKey));
  const uniqueDateKeys = Array.from(new Set(countableDateKeys)).sort();

  if (uniqueDateKeys.includes(todayKey)) {
    return todayKey;
  }

  return uniqueDateKeys.find((dateKey) => dateKey >= todayKey) ?? todayKey;
}
