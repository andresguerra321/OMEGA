import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const TECH_TOKEN_RE =
  /(\[\d+\]|\bCVE-\d{4}-\d{4,7}\b|\b[a-f0-9]{64}\b|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|ca|uk|xyz|top|info|me|co|gov|edu|online|site)\b)/gi;

export function formatTextWithTechAndCitations(text, citationMap, onSelectCitation) {
  if (!text) return null;
  const parts = String(text).split(TECH_TOKEN_RE);

  return parts.map((part, idx) => {
    if (!part) return null;

    // 1. Cita verificable [1] en JetBrains Mono
    const citMatch = part.match(/^\[(\d+)\]$/);
    if (citMatch) {
      const num = Number(citMatch[1]);
      const target = citationMap.get(num);
      return (
        <button
          key={idx}
          type="button"
          onClick={() => target && onSelectCitation?.(target)}
          title={target ? `${target.title} — Pág. ${target.page}` : `Fuente [${num}]`}
          className="font-tech mx-0.5 inline-flex items-center rounded-[4px] border border-[#3978F6]/40 bg-[#16243D] px-1.5 py-0 text-[11px] font-medium text-[#7AA7FF] hover:border-[#3978F6] hover:text-[#F0F2F5] transition-colors duration-150 cursor-pointer"
        >
          [{num}]
        </button>
      );
    }

    // 2. Datos técnicos (CVEs, SHA-256, dominios) en JetBrains Mono
    if (
      /^CVE-\d{4}-\d{4,7}$/i.test(part) ||
      /^[a-f0-9]{64}$/i.test(part) ||
      (/^(?:[a-z0-9-]+\.)+(?:com|net|org|io|ca|uk|xyz|top|info|me|co|gov|edu|online|site)$/i.test(part) &&
        !part.includes('citizenlab') &&
        !part.includes('amnesty'))
    ) {
      return (
        <span
          key={idx}
          className="font-tech rounded-[4px] border border-[#262B33] bg-[#13161B] px-1.5 py-0.5 text-[12px] text-[#F0F2F5]"
        >
          {part}
        </span>
      );
    }

    return part;
  });
}

function processChildren(children, citationMap, onSelectCitation) {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      return formatTextWithTechAndCitations(child, citationMap, onSelectCitation);
    }
    if (React.isValidElement(child) && child.props?.children) {
      return React.cloneElement(child, {
        children: processChildren(child.props.children, citationMap, onSelectCitation),
      });
    }
    return child;
  });
}

export function MarkdownMessage({ content, citations = [], onSelectCitation }) {
  const citationMap = new Map(citations.map((c) => [c.index, c]));
  const sanitized = (content || '').replace(/<br\s*\/?>/gi, '\n');
  const enhance = (children) => processChildren(children, citationMap, onSelectCitation);

  return (
    <div className="space-y-3 text-[14px] leading-[1.7] text-[#F0F2F5]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="border-b border-[#262B33] pb-2 text-[16px] font-semibold tracking-tight text-[#F0F2F5]">
              {enhance(children)}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="pt-2 text-[14.5px] font-semibold tracking-tight text-[#F0F2F5]">
              {enhance(children)}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="pt-1 text-[12.5px] font-semibold uppercase tracking-wider text-[#929BAA]">
              {enhance(children)}
            </h3>
          ),
          p: ({ children }) => (
            <p className="text-[#F0F2F5]/95">{enhance(children)}</p>
          ),
          ul: ({ children }) => (
            <ul className="space-y-2 pl-4 list-disc marker:text-[#3978F6]">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="space-y-2 pl-4 list-decimal marker:text-[#3978F6]">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="pl-1 text-[#F0F2F5]/95">{enhance(children)}</li>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-[#F0F2F5]">{enhance(children)}</strong>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-[#3978F6] bg-[#171A20] py-2 pl-3.5 pr-3 text-[13px] text-[#929BAA]">
              {enhance(children)}
            </blockquote>
          ),
          code: ({ inline, children }) =>
            inline ? (
              <code className="font-tech rounded-[4px] border border-[#262B33] bg-[#13161B] px-1.5 py-0.5 text-[12px] text-[#F0F2F5]">
                {children}
              </code>
            ) : (
              <pre className="font-tech overflow-x-auto rounded-[6px] border border-[#262B33] bg-[#13161B] p-3.5 text-[12px] text-[#F0F2F5]">
                <code>{children}</code>
              </pre>
            ),
        }}
      >
        {sanitized}
      </ReactMarkdown>
    </div>
  );
}
