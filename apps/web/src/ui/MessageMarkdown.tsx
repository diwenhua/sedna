import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MessageMarkdown({ content }: { content: string }) {
  if (content.trim().length === 0) {
    return null;
  }

  return (
    <div className="message-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
