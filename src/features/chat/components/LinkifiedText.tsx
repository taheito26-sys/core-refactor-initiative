// ─── LinkifiedText — Phase 11: Detect URLs and render as clickable links ─
import { useMemo } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  text: string;
  className?: string;
}

const URL_REGEX = /(https?:\/\/[^\s<>()[\]{}"']+)/gi;

export function LinkifiedText({ text, className }: Props) {
  const parts = useMemo(() => {
    const result: { type: 'text' | 'link'; value: string }[] = [];
    let lastIndex = 0;

    text.replace(URL_REGEX, (match, _g1, offset) => {
      if (offset > lastIndex) {
        result.push({ type: 'text', value: text.slice(lastIndex, offset) });
      }
      result.push({ type: 'link', value: match });
      lastIndex = offset + match.length;
      return match;
    });

    if (lastIndex < text.length) {
      result.push({ type: 'text', value: text.slice(lastIndex) });
    }

    return result;
  }, [text]);

  if (parts.length === 1 && parts[0].type === 'text') {
    return <span className={cn('whitespace-pre-wrap break-words', className)}>{text}</span>;
  }

  return (
    <span className={cn('whitespace-pre-wrap break-words', className)}>
      {parts.map((part, i) =>
        part.type === 'link' ? (
          <a
            key={i}
            href={part.value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 decoration-primary/40 hover:decoration-primary transition-colors break-all"
            onClick={(e) => e.stopPropagation()}
          >
            {part.value}
          </a>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </span>
  );
}
