import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/** Renders user-written Markdown. It is user content: always sanitized before injecting. */
export function Markdown({ source, className = '', testId }: { source: string; className?: string; testId?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true, breaks: true })), [source]);
  return <div className={`prose-idea ${className}`} data-testid={testId} dangerouslySetInnerHTML={{ __html: html }} />;
}
