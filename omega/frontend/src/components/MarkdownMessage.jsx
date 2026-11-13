import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const TECH_TOKEN_RE =
  /(\[\d+\]|\bCVE[-\u2010-\u2015\u2212]\d{4}[-\u2010-\u2015\u2212]\d{4,7}\b|\b[a-f0-9]{64}\b|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|ca|uk|xyz|top|info|me|co|gov|edu|online|site)\b)/gi;

const INLINE_MD_RE =
  /(`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*\n]+?\*\*|\*[^*\n]+?\*)/g;

const UNICODE_HYPHENS_RE = /[\u2010-\u2015\u2212]/g;

function renderTechTokens(text, citationMap, onSelectCitation, keyPrefix = 't') {
  if (!text) return null;
  const parts = String(text).split(TECH_TOKEN_RE);

  return parts.map((part, idx) => {
    if (!part) return null;
    const key = `${keyPrefix}-${idx}`;

    // 1. Cita verificable [1]
    const citMatch = part.match(/^\[(\d+)\]$/);
    if (citMatch) {
      const num = Number(citMatch[1]);
      const target = citationMap.get(num);
      return (
        <button
          key={key}
          type="button"
          onClick={() => target && onSelectCitation?.(target)}
          title={target ? `${target.title} — Pág. ${target.page}` : `Fuente [${num}]`}
          className="font-tech mx-0.5 inline-flex items-center rounded-[5px] border border-[#2F6FED]/40 bg-[#15223D] px-1.5 py-0 text-[12px] font-medium text-[#8AB4FF] hover:border-[#2F6FED]/75 hover:bg-[#1B2E52] hover:text-[#F4F6FA] active:scale-[0.94] transition-all duration-150 ease-kowalski cursor-pointer"
        >
          [{num}]
        </button>
      );
    }

    // 2. Datos técnicos (CVEs con guion ASCII o Unicode, SHA-256, dominios)
    const normalizedCve = part.replace(UNICODE_HYPHENS_RE, '-');
    if (
      /^CVE-\d{4}-\d{4,7}$/i.test(normalizedCve) ||
      /^[a-f0-9]{64}$/i.test(part) ||
      (/^(?:[a-z0-9-]+\.)+(?:com|net|org|io|ca|uk|xyz|top|info|me|co|gov|edu|online|site)$/i.test(part) &&
        !part.includes('citizenlab') &&
        !part.includes('amnesty'))
    ) {
      return (
        <span
          key={key}
          className="font-tech rounded-[5px] border border-[#2A2D36] bg-[#14161C] px-1.5 py-0.5 text-[13px] font-medium text-[#F2F4F8]"
        >
          {normalizedCve}
        </span>
      );
    }

    return part;
  });
}

export function formatTextWithTechAndCitations(text, citationMap, onSelectCitation) {
  if (!text) return null;
  const segments = String(text).split(INLINE_MD_RE);

  return segments.map((seg, sIdx) => {
    if (!seg) return null;

    if (seg.startsWith('`') && seg.endsWith('`') && seg.length >= 2) {
      return (
        <code
          key={`c-${sIdx}`}
          className="font-tech rounded-[5px] border border-[#2A2D36] bg-[#14161C] px-1.5 py-0.5 text-[13px] font-medium text-[#F2F4F8]"
        >
          {seg.slice(1, -1)}
        </code>
      );
    }

    const linkMatch = seg.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={`a-${sIdx}`}
          href={linkMatch[2]}
          target="_blank"
          rel="noreferrer"
          className="text-[#7AA7FF] underline underline-offset-2 hover:text-[#9FC0FF]"
        >
          {linkMatch[1]}
        </a>
      );
    }

    if (seg.startsWith('**') && seg.endsWith('**') && seg.length >= 4) {
      return (
        <strong key={`b-${sIdx}`} className="font-semibold text-[#F2F4F8]">
          {renderTechTokens(seg.slice(2, -2), citationMap, onSelectCitation, `b-${sIdx}`)}
        </strong>
      );
    }

    if (seg.startsWith('*') && seg.endsWith('*') && seg.length >= 2) {
      return (
        <em key={`i-${sIdx}`} className="italic text-[#D8DCE3]">
          {renderTechTokens(seg.slice(1, -1), citationMap, onSelectCitation, `i-${sIdx}`)}
        </em>
      );
    }

    return renderTechTokens(seg, citationMap, onSelectCitation, `t-${sIdx}`);
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
    <div className="max-w-[68ch] space-y-3.5 text-[15.5px] leading-[1.72] text-[#E6E9EF]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="border-b border-[#262B33] pb-2 text-[20px] font-semibold leading-[1.3] tracking-[-0.01em] text-[#F5F7FA]">
              {enhance(children)}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="pt-2.5 text-[17px] font-semibold leading-[1.35] text-[#F5F7FA]">
              {enhance(children)}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="pt-1.5 text-[13.5px] font-semibold uppercase tracking-[0.06em] text-[#A8B0BE]">
              {enhance(children)}
            </h3>
          ),
          p: ({ children }) => (
            <p className="text-[#E6E9EF]">{enhance(children)}</p>
          ),
          ul: ({ children }) => (
            <ul className="space-y-2.5 pl-5 list-disc marker:text-[#3978F6]">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="space-y-2.5 pl-5 list-decimal marker:text-[#3978F6]">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="pl-1.5 text-[#E6E9EF]">{enhance(children)}</li>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-[#FFFFFF]">{enhance(children)}</strong>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2.5 border-l-2 border-[#3978F6] bg-[#14171D] py-2.5 pl-4 pr-3.5 text-[14.5px] leading-[1.65] text-[#C8CFD9]">
              {enhance(children)}
            </blockquote>
          ),
          code: ({ inline, children }) =>
            inline ? (
              <code className="font-tech rounded-[4px] border border-[#2A2D36] bg-[#14161C] px-1.5 py-0.5 text-[13px] font-medium text-[#F2F4F8]">
                {children}
              </code>
            ) : (
              <pre className="font-tech overflow-x-auto rounded-[6px] border border-[#262B33] bg-[#12141A] p-4 text-[13px] leading-[1.6] text-[#F2F4F8]">
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
