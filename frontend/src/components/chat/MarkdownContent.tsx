import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

interface MarkdownContentProps {
  content: string;
}

export const MarkdownContent: React.FC<MarkdownContentProps> = ({ content }) => {
  return (
    <div className="prose prose-slate max-w-none break-words text-sm sm:text-base leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ node, inline, className, children, ...props }: any) {
            return !inline ? (
              <pre className="bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto text-xs sm:text-sm font-mono my-2 border border-slate-700">
                <code {...props}>{children}</code>
              </pre>
            ) : (
              <code className="bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded text-xs sm:text-sm font-mono" {...props}>
                {children}
              </code>
            );
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-4 border-indigo-500 pl-4 py-1 italic bg-indigo-50/50 rounded-r my-2 text-slate-700">
                {children}
              </blockquote>
            );
          },
          p({ children }) {
            return <p className="mb-2 last:mb-0">{children}</p>;
          },
          ul({ children }) {
            return <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>;
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
