import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const TECH_TOKEN_RE =
  /(\[\d+\]|\bCVE-\d{4}-\d{4,7}\b|\b[a-f0-9]{64}\b|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|ca|uk|xyz|top|info|me|co|gov|edu|online|site)\b)/gi;

export function formatTextWithTechAndCitations(text, citationMap, onSelectCitation) {
  if (!text) return null;
  const parts = String(text).split(TECH_TOKEN_RE);

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
            className="mx-0.5 inline-flex items-center rounded-[4px] border border-[#262B33] bg-[#13161B] px-1.5 py-0 text-[11px] font-medium text-[#3978F6] hover:border-[#3978F6]/60 hover:bg-[#171A20] transition-colors duration-150 cursor-pointer"
          >
            [{num}]
          </button>
        );
      }
    }

    // 2. Identificadores técnicos (CVEs, hashes SHA-256, dominios técnicos) en JetBrains Mono
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

export function RichInlineText({ text, citations = [], onSelectCitation }) {
  const citationMap = new Map(citations.map((c) => [c.index, c]));
  const strippedCode = String(text || '').replace(/`([^`]+)`/g, '$1');
  const boldParts = strippedCode.split(/(\*\*[^*]+?\*\*)/g);
  return (
    <>
      {boldParts.map((segment, i) => {
        if (segment.startsWith('**') && segment.endsWith('**') && segment.length > 4) {
          const inner = segment.slice(2, -2);
          return (
            <strong key={`b-${i}`} className="font-semibold text-[#F0F2F5]">
              {formatTextWithTechAndCitations(inner, citationMap, onSelectCitation)}
            </strong>
          );
        }
        return (
          <React.Fragment key={`t-${i}`}>
            {formatTextWithTechAndCitations(segment, citationMap, onSelectCitation)}
          </React.Fragment>
        );
      })}
    </>
  );
}

export function MarkdownMessage({ content, citations = [], onSelectCitation }) {
  const citationMap = new Map(citations.map((c) => [c.index, c]));
  const sanitized = (content || '').replace(/<br\s*\/?>/gi, '\n');
  const enhance = (children) => processChildren(children, citationMap, onSelectCitation);

  return (
    <div className="space-y-3.5 text-[14px] leading-[1.65] text-[#F0F2F5]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="border-b border-[#262B33] pb-2 text-[16px] font-semibold tracking-tight text-[#F0F2F5]">
              {enhance(children)}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="pt-2 text-[15px] font-semibold tracking-tight text-[#F0F2F5]">
              {enhance(children)}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="pt-1 text-[13px] font-semibold uppercase tracking-wider text-[#929BAA]">
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
            <blockquote className="my-2 border-l-2 border-[#262B33] bg-[#13161B] py-2 pl-3.5 pr-3 text-[13px] text-[#929BAA]">
              {enhance(children)}
            </blockquote>
          ),
          code: ({ inline, children }) =>
            inline ? (
              <code className="font-tech rounded-[4px] border border-[#262B33] bg-[#0D0F12] px-1.5 py-0.5 text-[12px] text-[#F0F2F5]">
                {children}
              </code>
            ) : (
              <pre className="font-tech overflow-x-auto rounded-[4px] border border-[#262B33] bg-[#0D0F12] p-3 text-[12px] text-[#F0F2F5]">
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
