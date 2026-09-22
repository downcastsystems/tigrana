/** Color choices keep their existing IDs so notebook snapshots remain portable. */
export const themeFamilies = [
  { id: 'plasma', name: 'Plasma', colors: [
    { id: 'dracula', name: 'Vampire' }, { id: 'plasma-ooze', name: 'Ooze' },
    { id: 'plasma-undertow', name: 'Undertow' }, { id: 'plasma-witches-brew', name: "Witch's Brew" },
  ] },
  { id: 'classic', name: 'Classic', colors: [
    { id: 'default', name: 'Default' }, { id: 'atom', name: 'Atom One' },
    { id: 'gruvbox', name: 'Gruvbox' }, { id: 'nord', name: 'Nord' }, { id: 'solarized', name: 'Solarized' },
  ] },
  { id: 'catppuccin', name: 'Catppuccin', colors: [
    { id: 'catppuccin-frappe', name: 'Frappe' }, { id: 'catppuccin-latte', name: 'Latte' },
    { id: 'catppuccin-macchiato', name: 'Macchiato' }, { id: 'catppuccin-mocha', name: 'Mocha' },
  ] },
];
export function themeFamily(id: string) {
  return themeFamilies.find(family => family.colors.some(color => color.id === id));
}
export function rememberedThemeColor(familyId: string, preferences?: Record<string, string>) {
  const family = themeFamilies.find(family => family.id === familyId);
  return family?.colors.find(color => color.id === preferences?.[familyId])?.id ?? family?.colors[0].id;
}
