// A tag starts at the beginning or after whitespace: "C#" is not a tag, "# x" is not a tag.
const TAG_RE = /(^|\s)[#＃]([^\s#＃]+)/g;

export function parseCapture(input: string): { title: string; tags: string[] } {
  const tags: string[] = [];
  const title = input
    .replace(TAG_RE, (_m, lead: string, tag: string) => {
      if (!tags.includes(tag)) tags.push(tag);
      return lead;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { title, tags };
}

export const BATCH_LIMIT = 500;
export const TITLE_MAX = 200;

/** Batch import: one idea per non-blank line, same #tag syntax as the capture box. Line numbers are 1-based. */
export function parseBatch(text: string) {
  const items: { line: number; title: string; tags: string[] }[] = [];
  const errors: { line: number; text: string; reason: string }[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const lineText = raw.trim();
    if (!lineText) return;
    const parsed = parseCapture(lineText);
    if (!parsed.title) errors.push({ line, text: lineText, reason: '没有标题' });
    else if (parsed.title.length > TITLE_MAX) errors.push({ line, text: lineText, reason: `标题超过 ${TITLE_MAX} 字` });
    else if (items.length >= BATCH_LIMIT) errors.push({ line, text: lineText, reason: `一次最多导入 ${BATCH_LIMIT} 条` });
    else items.push({ line, ...parsed });
  });
  return { items, errors };
}
