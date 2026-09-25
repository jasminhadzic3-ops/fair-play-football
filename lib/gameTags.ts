export const GAME_TAG_OPTIONS = [
  "Casual",
  "Competitive",
  "Beginners Welcome",
  "Intermediate",
  "Advanced",
  "Co-ed",
  "Goalkeeper Needed",
  "Indoor",
  "Outdoor",
  "Floodlit",
  "8-a-side",
  "7-a-side",
  "6-a-side",
  "Fast Pace",
  "Small Goals",
  "Full Size Goals",
] as const;

export const MAX_GAME_TAGS = 5;

export type GameTag = (typeof GAME_TAG_OPTIONS)[number];

const gameFormatTagMaxPlayers: Partial<Record<GameTag, number>> = {
  "6-a-side": 12,
  "7-a-side": 14,
  "8-a-side": 16,
};

const gameTagSet = new Set<string>(GAME_TAG_OPTIONS);

export function parseGameTags(value: unknown): GameTag[] | null {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || value.length > MAX_GAME_TAGS) {
    return null;
  }

  if (!value.every((tag): tag is string => typeof tag === "string" && gameTagSet.has(tag))) {
    return null;
  }

  return new Set(value).size === value.length ? (value as GameTag[]) : null;
}

export function getGameTags(value: unknown): GameTag[] {
  return parseGameTags(value) ?? [];
}

export function isGameFormatTag(tag: GameTag): boolean {
  return tag in gameFormatTagMaxPlayers;
}

export function getGameFormatMaxPlayers(tags: readonly GameTag[]): number | null | undefined {
  const selectedFormats = tags.filter(isGameFormatTag);

  if (selectedFormats.length === 0) {
    return undefined;
  }

  if (selectedFormats.length > 1) {
    return null;
  }

  return gameFormatTagMaxPlayers[selectedFormats[0]];
}

export function hasMatchingGameFormatTag(tags: readonly GameTag[], maxPlayers: number): boolean {
  const taggedMaxPlayers = getGameFormatMaxPlayers(tags);

  return taggedMaxPlayers === undefined || taggedMaxPlayers === maxPlayers;
}
