import { gitHubEmojis, shortcodeToEmoji } from "@tiptap/extension-emoji";

const emojiShortcodePattern = /:([a-zA-Z0-9_+-]+):/g;

export function emojiShortcodeToText(shortcode: string) {
  return shortcodeToEmoji(shortcode, gitHubEmojis)?.emoji ?? null;
}

export function replaceEmojiShortcodes(value: string) {
  return value.replace(emojiShortcodePattern, (match, shortcode: string) => emojiShortcodeToText(shortcode) ?? match);
}
