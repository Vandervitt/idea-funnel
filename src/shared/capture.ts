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
