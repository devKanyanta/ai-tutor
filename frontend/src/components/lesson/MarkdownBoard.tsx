import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

export const MarkdownBoard: React.FC<{ content: string }> = ({ content }) => (
  <div className="md-board">
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
        table: ({ children }) => <div className="table-wrap"><table>{children}</table></div>,
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);
