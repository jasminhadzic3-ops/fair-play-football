import { getGameTags } from "@/lib/gameTags";

type GameTagPillsProps = {
  tags?: unknown;
  className?: string;
};

export default function GameTagPills({ tags, className = "" }: GameTagPillsProps) {
  const gameTags = getGameTags(tags);

  if (gameTags.length === 0) {
    return null;
  }

  return (
    <div className={`flex flex-wrap gap-2 ${className}`.trim()} aria-label="Game tags">
      {gameTags.map((tag) => (
        <span
          key={tag}
          className="rounded-full border border-stone-200/20 bg-stone-200/10 px-3 py-1 text-xs font-semibold text-stone-200"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}
