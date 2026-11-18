import React, { useMemo, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DOMPurify from 'dompurify';

function safeHttps(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
}

const REMARK_PLUGINS = [remarkGfm];

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
          className="font-tech mx-0.5 inline-flex items-center rounded-[5px] border border-[#2F6FED]/45 bg-[rgba(28,36,56,0.65)] px-1.5 py-0 text-[12px] font-medium text-[#F2F2F4] hover:border-[#2F6FED]/75 hover:shadow-[0_0_18px_rgba(47,111,237,0.25)] hover:text-white active:scale-[0.94] transition-all duration-150 ease-apple cursor-pointer"
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
          className="font-tech rounded-[5px] border border-white/[0.08] bg-white/[0.045] px-1.5 py-0.5 text-[12.5px] font-medium text-[#F2F2F4]"
        >
          {normalizedCve}
        </span>
      );
    }

    return part;
  });
}

function formatTextWithTechAndCitations(text, citationMap, onSelectCitation) {
  if (!text) return null;
  const segments = String(text).split(INLINE_MD_RE);

  return segments.map((seg, sIdx) => {
    if (!seg) return null;

    if (seg.startsWith('`') && seg.endsWith('`') && seg.length >= 2) {
      return (
        <code
          key={`c-${sIdx}`}
          className="font-tech rounded-[5px] border border-white/[0.08] bg-white/[0.045] px-1.5 py-0.5 text-[12.5px] font-medium text-[#F2F2F4]"
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
          href={safeHttps(linkMatch[2]) || undefined}
          target="_blank"
          rel="noreferrer"
          className="text-[#F2F2F4] underline decoration-[#2F6FED] underline-offset-2 hover:text-white"
        >
          {linkMatch[1]}
        </a>
      );
    }

    if (seg.startsWith('**') && seg.endsWith('**') && seg.length >= 4) {
      return (
        <strong key={`b-${sIdx}`} className="font-semibold text-[#F2F2F4]">
          {renderTechTokens(seg.slice(2, -2), citationMap, onSelectCitation, `b-${sIdx}`)}
        </strong>
      );
    }

    if (seg.startsWith('*') && seg.endsWith('*') && seg.length >= 2) {
      return (
        <em key={`i-${sIdx}`} className="italic text-[#F2F2F4]/85">
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

export function MarkdownMessage({
  content,
  citations = [],
  onSelectCitation,
  isTyping = false,
}) {
  const selectCitationRef = useRef(onSelectCitation);
  useEffect(() => {
    selectCitationRef.current = onSelectCitation;
  }, [onSelectCitation]);

  const citationMap = useMemo(
    () => new Map(citations.map((c) => [c.index, c])),
    [citations]
  );

  const markdownComponents = useMemo(() => {
    const enhance = (children) =>
      processChildren(children, citationMap, (target) => selectCitationRef.current?.(target));
    return {
      a: ({ href, children }) => safeHttps(href)
        ? <a href={safeHttps(href)} target="_blank" rel="noopener noreferrer">{children}</a>
        : <span>{children}</span>,
      img: ({ alt }) => <span>{alt || ''}</span>,
      h1: ({ children }) => (
        <h1 className="border-b border-white/[0.08] pb-2 text-[20px] font-semibold leading-[1.3] tracking-[-0.02em] text-[#F2F2F4]">
          {enhance(children)}
        </h1>
      ),
      h2: ({ children }) => (
        <h2 className="pt-2.5 text-[17px] font-semibold leading-[1.35] tracking-[-0.015em] text-[#F2F2F4]">
          {enhance(children)}
        </h2>
      ),
      h3: ({ children }) => (
        <h3 className="pt-1.5 text-[13.5px] font-semibold tracking-[-0.01em] text-[#9A9AA2]">
          {enhance(children)}
        </h3>
      ),
      p: ({ children }) => (
        <p className="text-[#F2F2F4]/90">{enhance(children)}</p>
      ),
      ul: ({ children }) => (
        <ul className="space-y-2.5 pl-5 list-disc marker:text-[#2F6FED]">{children}</ul>
      ),
      ol: ({ children }) => (
        <ol className="space-y-2.5 pl-5 list-decimal marker:text-[#2F6FED]">{children}</ol>
      ),
      li: ({ children }) => (
        <li className="pl-1.5 text-[#F2F2F4]/90">{enhance(children)}</li>
      ),
      strong: ({ children }) => (
        <strong className="font-semibold text-[#F2F2F4]">{enhance(children)}</strong>
      ),
      blockquote: ({ children }) => (
        <blockquote className="apple-well my-2.5 rounded-[10px] py-3 px-4 text-[14.5px] leading-[1.65] text-[#F2F2F4]/85">
          {enhance(children)}
        </blockquote>
      ),
      table: ({ children }) => (
        <div className="my-2 w-full overflow-x-auto rounded-[10px] border border-white/[0.08]">
          <table className="w-full min-w-[420px] border-collapse text-left text-[13px] text-[#F2F2F4]/90">
            {children}
          </table>
        </div>
      ),
      thead: ({ children }) => (
        <thead className="border-b border-white/[0.08] bg-white/[0.04] text-[11px] font-medium uppercase tracking-wide text-[#9A9AA2]">
          {children}
        </thead>
      ),
      th: ({ children }) => (
        <th className="px-3 py-2 font-medium">{enhance(children)}</th>
      ),
      td: ({ children }) => (
        <td className="border-t border-white/[0.05] px-3 py-2 align-top">{enhance(children)}</td>
      ),
      pre: ({ children }) => (
        <pre className="apple-well font-tech overflow-x-auto rounded-[11px] p-3.5 sm:p-4 text-[12.5px] leading-[1.6] text-[#F2F2F4]">
          {children}
        </pre>
      ),
      code: ({ className, children }) => {
        const isBlock = Boolean(className?.startsWith('language-') || String(children || '').includes('\n'));
        if (isBlock) {
          return <code className={className}>{children}</code>;
        }
        return (
          <code className="font-tech break-words rounded-[5px] border border-white/[0.08] bg-white/[0.045] px-1.5 py-0.5 text-[12.5px] font-medium text-[#F2F2F4]">
            {children}
          </code>
        );
      },
    };
  }, [citationMap]);

  const sanitized = DOMPurify.sanitize(String(content || '').replace(/<br\s*\/?>/gi, '\n'), {
    ALLOWED_TAGS: [], ALLOWED_ATTR: [],
  });

  return (
    <div
      className={`max-w-[68ch] space-y-3.5 text-[15px] leading-[1.72] tracking-[-0.008em] text-[#F2F2F4]/90 ${
        isTyping ? 'omega-prose-typing' : ''
      }`}
    >
      <ReactMarkdown
        skipHtml
        urlTransform={(url) => safeHttps(url)}
        remarkPlugins={REMARK_PLUGINS}
        components={markdownComponents}
      >
        {sanitized}
      </ReactMarkdown>
    </div>
  );
}
