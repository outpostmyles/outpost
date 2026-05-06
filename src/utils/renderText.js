/**
 * Strip all markdown formatting from AI text before displaying.
 * Claude sometimes returns markdown even when told not to.
 */
export function renderPlainText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    // Escape HTML entities first to prevent XSS from API responses
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Strip bold **text** or __text__
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    // Strip italic *text* or _text_ (single)
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, '$1')
    // Strip headers ## text
    .replace(/^#{1,6}\s+/gm, '')
    // Strip bullet dashes at start of line
    .replace(/^\s*[-•]\s+/gm, '')
    // Strip inline code backticks
    .replace(/`(.+?)`/g, '$1')
    // Strip code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Clean up extra blank lines (3+ newlines → 2)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
