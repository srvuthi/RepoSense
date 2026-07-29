import { useEffect, useState } from 'react';
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
};

let nextId = 1;

export default function ChatPanel({ jobId, scope }: ChatPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');

  // A fresh repo means a fresh conversation - stale messages from a
  // previously analyzed repo would reference code that's no longer in scope.
  useEffect(() => {
    setMessages([]);
  }, [jobId]);

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

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-5 right-5 z-20 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-full shadow-lg hover:bg-blue-700 transition-colors"
      >
        Ask about this repo
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-20 w-96 h-[28rem] bg-white rounded-lg shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
      <div className="px-4 py-3 bg-slate-800 text-white flex justify-between items-center shrink-0">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Repo Chat</div>
          <div className="text-[11px] text-slate-300 truncate">
            chatting about: {scope ? scope.label : 'entire repo'}
          </div>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-slate-300 hover:text-white cursor-pointer focus:outline-none shrink-0 ml-2"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50">
        {messages.length === 0 && (
          <p className="text-xs text-slate-400 text-center mt-6">
            Ask a question about the analyzed repo to get started.
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`max-w-[90%] px-3 py-2 rounded-lg text-sm ${
              message.role === 'user'
                ? 'ml-auto bg-blue-600 text-white'
                : message.error
                  ? 'mr-auto bg-red-50 border border-red-200 text-red-700'
                  : 'mr-auto bg-white border border-slate-200 text-slate-800'
            }`}
          >
            {message.pending ? (
              <span className="inline-flex gap-1 items-center text-slate-400">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
              </span>
            ) : message.role === 'assistant' && !message.error ? (
              <div className="[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-1 [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:pl-4 [&_code]:bg-slate-100 [&_code]:rounded [&_code]:px-1 [&_code]:text-xs [&_pre]:bg-slate-100 [&_pre]:rounded [&_pre]:p-2 [&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0">
                <ReactMarkdown>{message.content}</ReactMarkdown>
              </div>
            ) : (
              message.content
            )}
          </div>
        ))}
      </div>

      <form onSubmit={handleSend} className="p-2 border-t border-slate-200 flex gap-2 shrink-0">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 px-3 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  );
}
