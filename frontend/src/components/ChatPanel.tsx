import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { API_BASE_URL, extractErrorMessage } from '../lib/api';

export type ChatScope = { id: string; label: string } | null;

type Citation = { file_path: string; start_line: number; end_line: number };

type ChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  pending?: boolean;
  error?: boolean;
};

type ChatPanelProps = {
  jobId: string | null;
  scope: ChatScope;
  onCitationClick?: (filePath: string) => void;
};

let nextId = 1;

const MARKDOWN_CLASSES =
  '[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-1 [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:pl-4 ' +
  '[&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_code]:text-[11px] [&_pre]:my-1 [&_pre]:overflow-x-auto ' +
  '[&_pre]:rounded [&_pre]:bg-black/30 [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0';

// Reveals the answer progressively instead of popping in all at once - the
// tick count is fixed (~60) so long and short answers finish in about the
// same wall-clock time.
function TypewriterAnswer({ content }: { content: string }) {
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    if (!content) return;
    const step = Math.max(1, Math.ceil(content.length / 60));
    const id = setInterval(() => {
      setVisible((v) => {
        const next = v + step;
        if (next >= content.length) {
          clearInterval(id);
          return content.length;
        }
        return next;
      });
    }, 14);
    return () => clearInterval(id);
  }, [content]);

  return (
    <div className={MARKDOWN_CLASSES}>
      <ReactMarkdown>{content.slice(0, visible)}</ReactMarkdown>
    </div>
  );
}

function CitationChips({ citations, onClick }: { citations: Citation[]; onClick?: (filePath: string) => void }) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {citations.map((c, i) => (
        <button
          key={`${c.file_path}-${c.start_line}-${i}`}
          onClick={() => onClick?.(c.file_path)}
          className="cursor-pointer rounded-full border border-cyan-300/25 bg-cyan-400/10 px-2 py-0.5 font-mono text-[10px] text-cyan-200 transition-colors hover:border-cyan-300/50 hover:bg-cyan-400/20"
          title={`Open ${c.file_path}`}
        >
          {c.file_path.split('/').pop()}:{c.start_line}
          {c.end_line !== c.start_line ? `-${c.end_line}` : ''}
        </button>
      ))}
    </div>
  );
}

export default function ChatPanel({ jobId, scope, onCitationClick }: ChatPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;

    if (!jobId) {
      setMessages((prev) => [
        ...prev,
        { id: nextId++, role: 'user', content: text },
        { id: nextId++, role: 'assistant', content: 'Analyze a repo first, then ask me about it.', error: true },
      ]);
      setInput('');
      return;
    }

    const userMessage: ChatMessage = { id: nextId++, role: 'user', content: text };
    const pendingId = nextId++;
    setMessages((prev) => [...prev, userMessage, { id: pendingId, role: 'assistant', content: '', pending: true }]);
    setInput('');

    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, message: text, scope: scope?.id ?? null }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(extractErrorMessage(data, response.status));
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId ? { ...m, content: data.answer, citations: data.citations, pending: false } : m
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Something went wrong asking that question.';
      setMessages((prev) =>
        prev.map((m) => (m.id === pendingId ? { ...m, content: message, pending: false, error: true } : m))
      );
    }
  };

  return (
    <>
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-5 right-5 z-20 rounded-full bg-gradient-to-r from-cyan-400 to-violet-400 px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-[0_0_24px_-4px_rgba(34,211,238,0.6)] transition-transform hover:scale-105"
          >
            Ask about this repo
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            className="glass-panel fixed bottom-5 right-5 z-20 flex h-[28rem] w-96 flex-col overflow-hidden rounded-xl shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--color-ink)]">Repo Chat</div>
                <div className="truncate text-[11px] text-[var(--color-muted)]">
                  chatting about: {scope ? scope.label : 'entire repo'}
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="ml-2 shrink-0 cursor-pointer text-[var(--color-muted)] hover:text-white focus:outline-none"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {messages.length === 0 && (
                <p className="mt-6 text-center text-xs text-[var(--color-muted)]">
                  Ask a question about the analyzed repo to get started.
                </p>
              )}
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${
                    message.role === 'user'
                      ? 'ml-auto bg-gradient-to-br from-cyan-400/90 to-violet-400/90 text-slate-900'
                      : message.error
                        ? 'mr-auto border border-red-400/25 bg-red-400/10 text-red-200'
                        : 'mr-auto border border-white/10 bg-white/[0.04] text-[var(--color-ink)]'
                  }`}
                >
                  {message.pending ? (
                    <span className="inline-flex items-center gap-1 text-[var(--color-muted)]">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300 [animation-delay:-0.3s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300 [animation-delay:-0.15s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-300" />
                    </span>
                  ) : message.role === 'assistant' && !message.error ? (
                    <>
                      <TypewriterAnswer content={message.content} />
                      <CitationChips citations={message.citations ?? []} onClick={onCitationClick} />
                    </>
                  ) : (
                    message.content
                  )}
                </motion.div>
              ))}
            </div>

            <form onSubmit={handleSend} className="flex shrink-0 gap-2 border-t border-white/10 p-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-muted)] focus:border-cyan-300/50 focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
              />
              <button
                type="submit"
                className="cursor-pointer rounded-lg bg-gradient-to-r from-cyan-400 to-violet-400 px-3 py-1.5 text-sm font-semibold text-slate-900 transition-opacity hover:opacity-90"
              >
                Send
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
