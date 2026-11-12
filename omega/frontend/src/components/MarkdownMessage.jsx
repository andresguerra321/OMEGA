import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function injectCitationButtons(children, citationMap, onSelectCitation) {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      const parts = child.split(/(\[\d+\])/g);
      return parts.map((part, idx) => {
        const match = part.match(/^\[(\d+)\]$/);
        if (match) {
          const num = Number(match[1]);
          const target = citationMap.get(num);
          if (target) {
            return (
              <button
                key={idx}
                type="button"
                onClick={() => onSelectCitation(target)}
                title={`${target.title} — Pág. ${target.page}`}
                className="mx-0.5 inline-flex -translate-y-0.5 items-center rounded border border-emerald-500/40 bg-emerald-950/70 px-1.5 py-0.2 font-mono text-[11px] font-medium text-emerald-300 hover:border-emerald-400 hover:bg-emerald-900/80 transition cursor-pointer"
              >
                [{num}]
              </button>
            );
          }
        }
        return part;
      });
    }

    if (React.isValidElement(child) && child.props?.children) {
      return React.cloneElement(child, {
        children: injectCitationButtons(child.props.children, citationMap, onSelectCitation),
      });
    }

    return child;
  });
}

export function MarkdownMessage({ content, citations = [], onSelectCitation }) {
  const citationMap = new Map(citations.map((c) => [c.index, c]));
  // Limpia cualquier <br> residual si apareciera
  const sanitized = (content || '').replace(/<br\s*\/?>/gi, '\n');

  const withCitations = (children) =>
    injectCitationButtons(children, citationMap, onSelectCitation);

  return (
    <div className="space-y-3 text-[14px] leading-7 text-zinc-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="border-b border-zinc-800 pb-2 text-base font-semibold tracking-tight text-zinc-100">
              {withCitations(children)}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="pt-2 text-[15px] font-semibold tracking-tight text-zinc-100">
              {withCitations(children)}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="pt-1 text-sm font-semibold text-emerald-400/90">
              {withCitations(children)}
            </h3>
          ),
          p: ({ children }) => (
            <p className="leading-7 text-zinc-300">{withCitations(children)}</p>
          ),
          ul: ({ children }) => (
            <ul className="space-y-2.5 pl-4 list-disc marker:text-emerald-500/70">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="space-y-2.5 pl-4 list-decimal marker:text-emerald-400">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="pl-1 leading-relaxed text-zinc-300">
              {withCitations(children)}
            </li>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-zinc-100">
              {withCitations(children)}
            </strong>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-emerald-500/60 bg-zinc-950/70 py-2 pl-3.5 pr-3 rounded-r-lg text-xs italic text-zinc-400">
              {withCitations(children)}
            </blockquote>
          ),
          code: ({ inline, children }) =>
            inline ? (
              <code className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-xs text-emerald-300">
                {children}
              </code>
            ) : (
              <pre className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950 p-3.5 font-mono text-xs text-zinc-300">
                <code>{children}</code>
              </pre>
            ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-xl border border-zinc-800">
              <table className="w-full border-collapse text-left text-xs">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-zinc-800 bg-zinc-950 text-zinc-300">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 font-semibold">{withCitations(children)}</th>
          ),
          td: ({ children }) => (
            <td className="border-t border-zinc-800/70 px-3 py-2 align-top text-zinc-300">
              {withCitations(children)}
            </td>
          ),
        }}
      >
        {sanitized}
      </ReactMarkdown>
    </div>
  );
}

