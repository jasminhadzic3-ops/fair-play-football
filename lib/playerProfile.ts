export const PLAYER_POSITION_OPTIONS = [
  "Goalkeeper",
  "Defender",
  "Midfielder",
  "Forward",
  "Winger",
  "Flexible",
] as const;

export const PREFERRED_FOOT_OPTIONS = ["Left", "Right", "Both"] as const;
export const FOOT_RATING_VALUES = [1, 2, 3, 4, 5] as const;

export const ACCELERATE_OPTIONS = [
  "Explosive",
  "Mostly Explosive",
  "Controlled Explosive",
  "Controlled",
  "Controlled Lengthy",
  "Mostly Lengthy",
  "Lengthy",
] as const;

export type PlayerPosition = (typeof PLAYER_POSITION_OPTIONS)[number];
export type PreferredFoot = (typeof PREFERRED_FOOT_OPTIONS)[number];
export type FootRating = (typeof FOOT_RATING_VALUES)[number];
export type AccelerateType = (typeof ACCELERATE_OPTIONS)[number];

export const ACCELERATE_DESCRIPTIONS: Record<AccelerateType, string> = {
  Explosive: "Quick initial acceleration over short distances.",
  "Mostly Explosive": "Primarily explosive movement with some controlled characteristics.",
  "Controlled Explosive": "A balanced blend of explosive acceleration and controlled movement.",
  Controlled: "Balanced acceleration without a strong explosive or lengthy bias.",
  "Controlled Lengthy": "A blend of controlled movement and longer-stride acceleration.",
  "Mostly Lengthy": "Primarily longer-stride acceleration with some controlled characteristics.",
  Lengthy: "Builds speed more gradually and carries speed well over longer distances.",
};

export const POSITION_SHORT_LABELS: Record<PlayerPosition, string> = {
  Goalkeeper: "GK",
  Defender: "DEF",
  Midfielder: "MID",
  Forward: "FWD",
  Winger: "WING",
  Flexible: "FLEX",
};

export function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("") || "FP";
}

export function isPlayerPosition(value: string): value is PlayerPosition {
  return (PLAYER_POSITION_OPTIONS as readonly string[]).includes(value);
}

export function isPreferredFoot(value: string): value is PreferredFoot {
  return (PREFERRED_FOOT_OPTIONS as readonly string[]).includes(value);
}

export function isFootRating(value: number | null | undefined): value is FootRating {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

export function formatFootRating(value: number | null | undefined) {
  return isFootRating(value) ? `${"★".repeat(value)}${"☆".repeat(5 - value)}` : "N/A";
}

export function isAccelerateType(value: string): value is AccelerateType {
  return (ACCELERATE_OPTIONS as readonly string[]).includes(value);
}
