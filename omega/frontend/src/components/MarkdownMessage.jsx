import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const TECH_TOKEN_RE =
  /(\[\d+\]|\bCVE-\d{4}-\d{4,7}\b|\b[a-f0-9]{64}\b|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|ca|uk|xyz|top|info|me|co|gov|edu)\b)/gi;

function formatTextWithTechAndCitations(text, citationMap, onSelectCitation) {
  const parts = text.split(TECH_TOKEN_RE);

  return parts.map((part, idx) => {
    if (!part) return null;

    // 1. Índice de cita verificable [1], [2]
    const citMatch = part.match(/^\[(\d+)\]$/);
    if (citMatch) {
      const num = Number(citMatch[1]);
      const target = citationMap.get(num);
      if (target) {
        return (
          <button
            key={idx}
            type="button"
            onClick={() => onSelectCitation(target)}
            title={`${target.title} — Pág. ${target.page}`}
            className="mx-0.5 inline-flex items-center rounded-[4px] border border-[#232329] bg-[#191B22] px-1.5 py-0 text-[11px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/50 hover:bg-[#1C1C22] transition-colors cursor-pointer"
          >
            [{num}]
          </button>
        );
      }
    }

    // 2. Identificadores técnicos (CVEs y hashes SHA-256) exclusivamente en JetBrains Mono
    if (
      /^CVE-\d{4}-\d{4,7}$/i.test(part) ||
      /^[a-f0-9]{64}$/i.test(part)
    ) {
      return (
        <span
          key={idx}
          className="font-tech rounded-[4px] border border-[#232329] bg-[#141418] px-1.5 py-0.5 text-[12px] text-[#F2F2F4]"
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
    <div className="space-y-3.5 text-[14px] leading-[1.65] text-[#F2F2F4]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="border-b border-[#232329] pb-2 text-[16px] font-semibold tracking-tight text-[#F2F2F4]">
              {enhance(children)}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="pt-2 text-[15px] font-semibold tracking-tight text-[#F2F2F4]">
              {enhance(children)}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="pt-1 text-[13px] font-semibold uppercase tracking-wider text-[#8E8E96]">
              {enhance(children)}
            </h3>
          ),
          p: ({ children }) => (
            <p className="text-[#F2F2F4]/95">{enhance(children)}</p>
          ),
          ul: ({ children }) => (
            <ul className="space-y-2 pl-4 list-disc marker:text-[#2F6FED]">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="space-y-2 pl-4 list-decimal marker:text-[#2F6FED]">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="pl-1 text-[#F2F2F4]/95">{enhance(children)}</li>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-[#F2F2F4]">{enhance(children)}</strong>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-[#232329] bg-[#141418] py-2 pl-3.5 pr-3 text-[13px] text-[#8E8E96]">
              {enhance(children)}
            </blockquote>
          ),
          code: ({ inline, children }) =>
            inline ? (
              <code className="font-tech rounded-[4px] border border-[#232329] bg-[#0A0A0C] px-1.5 py-0.5 text-[12px] text-[#F2F2F4]">
                {children}
              </code>
            ) : (
              <pre className="font-tech overflow-x-auto rounded-[4px] border border-[#232329] bg-[#0A0A0C] p-3 text-[12px] text-[#F2F2F4]">
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
