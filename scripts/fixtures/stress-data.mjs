// Shared by the browser benchmark and the on-disk fixture generator.
export const WORDS_PER_PAGE = 500;
const vocabulary = 'The team reviewed the notebook and recorded a clear account of the work Each observation includes enough context to remain useful when someone returns later We compare results across several examples and keep the original evidence beside the decision'.split(' ');
export function documentBody(pages) {
  return Array.from({ length: pages }, (_, page) => {
    // The heading contributes two words; prose contributes the remaining 498.
    const words = Array.from({ length: 498 }, (_, i) => vocabulary[(i + page) % vocabulary.length]);
    const paragraphs = [];
    for (let i = 0; i < words.length; i += 100) paragraphs.push(words.slice(i, i + 100).join(' '));
    return `## Page ${page + 1}\n\n${paragraphs.join('\n\n')}`;
  }).join('\n\n') + '\n';
}
export function smallNote(index) {
  return `## Stress note ${index}\n\nSearch marker stressneedle${String(index).padStart(5, '0')}.\n\n${documentBody(1)}\n- [ ] Review this note\n- [x] Generate fixture\n\nA **bold** phrase, an *italic* phrase, and \`inline code\`.\n`;
}
