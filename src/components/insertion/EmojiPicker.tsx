import { gitHubEmojis, type EmojiItem } from "@tiptap/extension-emoji";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export function EmojiPicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (shortcode: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searching = Boolean(query.trim());
  const filtered = useMemo(() => searchEmojiItems(gitHubEmojis, query), [query]);
  const browseSections = useMemo(() => buildEmojiBrowseSections(gitHubEmojis), []);
  const browsable = useMemo(() => browseSections.flatMap((section) => section.items), [browseSections]);
  const visibleItems = searching ? filtered : browsable;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const submitAtIndex = (index: number) => {
    const emoji = visibleItems[index];
    const shortcode = emoji?.shortcodes[0] ?? emoji?.name;
    if (shortcode) onPick(shortcode);
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog emoji-picker" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <span className="dialog-icon">😊</span>
          <div>
            <h2>Insert emoji</h2>
            <p>Search by emoji name or shortcode</p>
          </div>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <input
          className="dialog-input"
          placeholder="Search emoji"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelectedIndex((index) => Math.min(index + 1, Math.max(visibleItems.length - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelectedIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              submitAtIndex(selectedIndex);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
          autoFocus
        />
        <div className={`emoji-picker-list${searching ? " is-searching" : ""}`} role="listbox">
          {searching ? (
            filtered.length ? filtered.map((emoji, index) => (
              <EmojiSearchRow
                emoji={emoji}
                index={index}
                key={`${emoji.name}-${emoji.shortcodes[0] ?? ""}`}
                selectedIndex={selectedIndex}
                onPick={submitAtIndex}
                onSelect={setSelectedIndex}
              />
            )) : <div className="move-empty">No matches</div>
          ) : browseSections.length ? (
            browseSections.map((section) => {
              const sectionStart = browsable.indexOf(section.items[0]);
              return (
                <section className="emoji-picker-section" key={section.id}>
                  <h3>{section.title}</h3>
                  <div className="emoji-picker-grid">
                    {section.items.map((emoji, index) => {
                      const totalIndex = sectionStart + index;
                      const shortcode = emoji.shortcodes[0] ?? emoji.name;
                      return (
                        <button
                          key={`${emoji.name}-${shortcode}`}
                          type="button"
                          className={`emoji-picker-tile${totalIndex === selectedIndex ? " is-selected" : ""}`}
                          aria-label={`${humanizeEmojiName(emoji.name)} :${shortcode}:`}
                          title={`:${shortcode}:`}
                          onMouseEnter={() => setSelectedIndex(totalIndex)}
                          onClick={() => submitAtIndex(totalIndex)}
                        >
                          {emoji.emoji ?? "?"}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })
          ) : (
            <div className="move-empty">No matches</div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmojiSearchRow({
  emoji,
  index,
  selectedIndex,
  onPick,
  onSelect,
}: {
  emoji: EmojiItem;
  index: number;
  selectedIndex: number;
  onPick: (index: number) => void;
  onSelect: (index: number) => void;
}) {
  return (
    <button
      type="button"
      className={`emoji-picker-row${index === selectedIndex ? " is-selected" : ""}`}
      onMouseEnter={() => onSelect(index)}
      onClick={() => onPick(index)}
    >
      <span className="emoji-picker-glyph">{emoji.emoji ?? "?"}</span>
      <span className="emoji-picker-title">{humanizeEmojiName(emoji.name)}</span>
      <span className="emoji-picker-shortcode">:{emoji.shortcodes[0] ?? emoji.name}:</span>
    </button>
  );
}

function searchEmojiItems(items: EmojiItem[], query: string) {
  const normalized = query.trim().replace(/^:|:$/g, "").toLowerCase();
  if (!normalized) return [];
  return items
    .filter((emoji) =>
      emoji.name.toLowerCase().includes(normalized) ||
      emoji.shortcodes.some((shortcode) => shortcode.toLowerCase().includes(normalized)) ||
      emoji.tags.some((tag) => tag.toLowerCase().includes(normalized)),
    )
    .slice(0, 80);
}

type EmojiBrowseSection = {
  id: string;
  title: string;
  items: EmojiItem[];
};

const emojiGroupOrder = [
  "(smileys)",
  "people & body",
  "animals & nature",
  "food & drink",
  "activities",
  "travel & places",
  "objects",
  "symbols",
  "flags",
  "GitHub",
] as const;

function buildEmojiBrowseSections(items: EmojiItem[]): EmojiBrowseSection[] {
  const sections = new Map<string, EmojiItem[]>();
  emojiGroupOrder.forEach((group) => sections.set(group, []));

  items.forEach((emoji) => {
    if (!emoji.emoji || emoji.name.startsWith("regional_indicator_") || emoji.group === "components") return;
    const group = emoji.group || "(smileys)";
    sections.get(group)?.push(emoji);
  });

  return emojiGroupOrder
    .map((group) => ({
      id: group,
      title: emojiGroupTitle(group),
      items: sections.get(group) ?? [],
    }))
    .filter((section) => section.items.length);
}

function emojiGroupTitle(group: string) {
  switch (group) {
    case "(smileys)":
      return "Smileys & Emotion";
    case "people & body":
      return "People & Body";
    case "animals & nature":
      return "Animals & Nature";
    case "food & drink":
      return "Food & Drink";
    case "travel & places":
      return "Travel & Places";
    default:
      return group.replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
}

function humanizeEmojiName(name: string) {
  return name.replace(/[_-]+/g, " ");
}
