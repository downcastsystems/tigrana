/** Color choices keep their existing IDs so notebook snapshots remain portable. */
export const themeFamilies = [
  { id: 'plasma', name: 'Plasma', colors: [
    { id: 'dracula', name: 'Vampire' }, { id: 'plasma-ooze', name: 'Ooze' },
    { id: 'plasma-undertow', name: 'Undertow' }, { id: 'plasma-witches-brew', name: "Witch's Brew" },
  ] },
  { id: 'classic', name: 'Classic', colors: [
    // Keep the old default ID so existing notebooks and resets select Blue.
    { id: 'default', name: 'Blue' }, { id: 'classic-gray', name: 'Gray' },
    { id: 'classic-green', name: 'Green' }, { id: 'classic-purple', name: 'Purple' },
    { id: 'atom', name: 'Atom' },
    { id: 'everforest', name: 'Everforest' }, { id: 'gruvbox', name: 'Gruvbox' }, { id: 'nord', name: 'Nord' }, { id: 'solarized', name: 'Solarized' },
    { id: 'catppuccin-frappe', name: 'Catppuccin Frappe' }, { id: 'catppuccin-latte', name: 'Catppuccin Latte' },
    { id: 'catppuccin-macchiato', name: 'Catppuccin Macchiato' }, { id: 'catppuccin-mocha', name: 'Catppuccin Mocha' },
  ] },
];
export function themeFamily(id: string) {
  return themeFamilies.find(family => family.colors.some(color => color.id === id));
}
export function rememberedThemeColor(familyId: string, preferences?: Record<string, string>) {
  const family = themeFamilies.find(family => family.id === familyId);
  return family?.colors.find(color => color.id === preferences?.[familyId])?.id
    // Older notebooks remembered these palettes under a separate family.
    ?? (familyId === 'classic' ? family?.colors.find(color => color.id === preferences?.catppuccin)?.id : undefined)
    ?? family?.colors[0].id;
}
