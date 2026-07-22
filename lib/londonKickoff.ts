import "server-only";

const londonTimeZone = "Europe/London";
const localDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const localTimePattern = /^(\d{2}):(\d{2})$/;

type LondonDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

type LondonKickoffResult = {
  startsAtIso: string;
  displayTime: string;
};

const londonDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: londonTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const londonDisplayFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: londonTimeZone,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parseLocalDate(localDate: unknown) {
  if (typeof localDate !== "string") {
    return null;
  }

  const match = localDate.match(localDatePattern);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcDate = new Date(Date.UTC(year, month - 1, day));

  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function parseLocalTime(localTime: unknown) {
  if (typeof localTime !== "string") {
    return null;
  }

  const match = localTime.match(localTimePattern);

  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour > 23 || minute > 59) {
    return null;
  }

  return { hour, minute };
}

function getLondonParts(date: Date): LondonDateTimeParts {
  const parts = londonDateTimeFormatter.formatToParts(date);
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(valueByType.get("year")),
    month: Number(valueByType.get("month")),
    day: Number(valueByType.get("day")),
    hour: Number(valueByType.get("hour")),
    minute: Number(valueByType.get("minute")),
  };
}

function matchesLondonParts(candidate: Date, expected: LondonDateTimeParts) {
  const actual = getLondonParts(candidate);

  return (
    actual.year === expected.year &&
    actual.month === expected.month &&
    actual.day === expected.day &&
    actual.hour === expected.hour &&
    actual.minute === expected.minute
  );
}

function formatLondonDisplay(date: Date) {
  return londonDisplayFormatter.format(date);
}

export function parseLondonKickoff(
  localDate: unknown,
  localTime: unknown
): LondonKickoffResult | null {
  const parsedDate = parseLocalDate(localDate);
  const parsedTime = parseLocalTime(localTime);

  if (!parsedDate || !parsedTime) {
    return null;
  }

  const expected = { ...parsedDate, ...parsedTime };
  const localAsUtc = Date.UTC(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hour,
    expected.minute
  );
  const matchingCandidates = new Map<number, Date>();

  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = new Date(localAsUtc - offsetMinutes * 60 * 1000);

    if (matchesLondonParts(candidate, expected)) {
      matchingCandidates.set(candidate.getTime(), candidate);
    }
  }

  if (matchingCandidates.size !== 1) {
    return null;
  }

  const startsAt = Array.from(matchingCandidates.values())[0];

  return {
    startsAtIso: startsAt.toISOString(),
    displayTime: formatLondonDisplay(startsAt),
  };
}

export function getLondonKickoffFormValues(startsAt: string | null | undefined) {
  if (!startsAt) {
    return { kickoffDate: "", kickoffTime: "" };
  }

  const date = new Date(startsAt);

  if (Number.isNaN(date.getTime())) {
    return { kickoffDate: "", kickoffTime: "" };
  }

  const parts = getLondonParts(date);

  return {
    kickoffDate: [
      String(parts.year).padStart(4, "0"),
      String(parts.month).padStart(2, "0"),
      String(parts.day).padStart(2, "0"),
    ].join("-"),
    kickoffTime: [
      String(parts.hour).padStart(2, "0"),
      String(parts.minute).padStart(2, "0"),
    ].join(":"),
  };
}
