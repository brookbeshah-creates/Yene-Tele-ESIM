import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, Sparkles, X } from 'lucide-react';
import { useRouter } from '../../router/RouterContext';

const QUICK_QUESTIONS = [
  'How do I buy an eSIM?',
  'Check *#06# support',
  'Fayda KYC steps?',
  'Best eSIM phones?',
];

interface ChatItem {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
}

export function MelaAssistant() {
  const { pathname } = useRouter();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatItem[]>([
    {
      id: 'mela-welcome',
      role: 'assistant',
      text: 'Selam! I’m Mela (መላ). Ask me anything about Ethiopian eSIMs, *#06#, Fayda KYC, or phones.',
    },
  ]);

  const feedEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open]);

  const askMela = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed || busy) return;

    setQuestion('');
    const userItem: ChatItem = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
    };
    const nextHistory = [...messages, userItem];
    const assistantId = `a-${Date.now()}`;
    setMessages(nextHistory);
    setBusy(true);

    try {
      const historyPayload = nextHistory
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-4)
        .map((m) => ({ role: m.role as 'user' | 'assistant', text: m.text }));

      const res = await fetch('/api/v1/mela/ask?stream=1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          question: trimmed,
          history: historyPayload,
          currentPath: pathname,
        }),
      });

      const contentType = res.headers.get('content-type') ?? '';
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(errBody.message || 'Mela could not answer right now.');
      }

      if (contentType.includes('text/event-stream') && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let createdBubble = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine.startsWith('data:')) continue;
            const jsonStr = trimmedLine.slice(5).trim();
            if (!jsonStr) continue;
            const parsed = JSON.parse(jsonStr) as {
              delta?: string;
              error?: string;
              done?: boolean;
            };
            if (parsed.error) {
              throw new Error(parsed.error);
            }
            if (parsed.delta) {
              if (!createdBubble) {
                createdBubble = true;
                setMessages((prev) => [
                  ...prev,
                  { id: assistantId, role: 'assistant', text: parsed.delta! },
                ]);
              } else {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, text: m.text + parsed.delta! } : m,
                  ),
                );
              }
            }
          }
        }
      } else {
        const data = (await res.json()) as { answer?: string };
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: 'assistant',
            text: data.answer || 'No response received.',
          },
        ]);
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Mela could not answer right now. Please try again.';
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'error',
          text: msg,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void askMela(question);
  };

  return (
    <>
      {/* Ultra-compact Translucent Morphic Glass Launcher */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ask Mela"
          className="fixed bottom-20 md:bottom-4 right-3 sm:right-4 z-40 inline-flex items-center gap-1.5 h-9 pl-1.5 pr-3 rounded-full bg-white/25 dark:bg-[#0F172A]/35 backdrop-blur-xl backdrop-saturate-150 text-[#202124] dark:text-white border border-white/60 dark:border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_8px_24px_-6px_rgba(15,23,42,0.2)] hover:bg-white/45 dark:hover:bg-[#0F172A]/55 transition-all active:scale-95 cursor-pointer"
        >
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-tr from-[#4285F4] via-[#34A853] to-[#FBBC05] text-white text-[11px] font-extrabold shadow-2xs shrink-0">
            M
          </span>
          <span className="text-[11px] font-semibold whitespace-nowrap">Ask Mela</span>
        </button>
      )}

      {/* Compact Transparent Morphic Glass Ask Card */}
      {open && (
        <div
          role="dialog"
          aria-label="Ask Mela"
          className="fixed bottom-20 md:bottom-4 right-3 sm:right-4 z-50 w-[calc(100vw-28px)] max-w-[286px] h-[340px] max-h-[54vh] rounded-3xl overflow-hidden bg-white/40 dark:bg-[#0B1220]/45 backdrop-blur-2xl backdrop-saturate-150 text-[#202124] dark:text-white border border-white/60 dark:border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_20px_50px_-14px_rgba(15,23,42,0.28)] flex flex-col"
        >
          {/* Thin Google 4-color top hairline */}
          <div className="h-0.5 w-full bg-gradient-to-r from-[#4285F4] via-[#EA4335] via-[#FBBC05] to-[#34A853] shrink-0" />

          {/* Compact Morphic Header */}
          <div className="px-3 py-1.5 flex items-center justify-between gap-2 border-b border-white/35 dark:border-white/12 bg-white/20 dark:bg-white/5 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-tr from-[#4285F4] via-[#34A853] to-[#FBBC05] text-white text-[11px] font-extrabold shrink-0">
                M
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold leading-tight truncate">Mela · መላ</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close Mela"
              className="h-7 w-7 inline-flex items-center justify-center rounded-full hover:bg-black/10 dark:hover:bg-white/15 text-[#5F6368] dark:text-white/85 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Transparent Frosted Ask Feed */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-2.5 py-1.5 text-[11.5px] leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-[#1A73E8]/90 backdrop-blur-md text-white shadow-xs'
                      : m.role === 'error'
                        ? 'bg-[#FEE2E2]/80 dark:bg-[#7F1D1D]/55 border border-[#FCA5A5]/60 dark:border-[#EF4444]/40 text-[#991B1B] dark:text-[#FECACA]'
                        : 'bg-white/60 dark:bg-white/12 backdrop-blur-md text-[#202124] dark:text-white border border-white/65 dark:border-white/15'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-1.5 rounded-2xl px-2.5 py-1.5 text-[11px] bg-white/55 dark:bg-white/12 backdrop-blur-md border border-white/65 dark:border-white/15 text-[#5F6368] dark:text-white/80">
                  <Sparkles className="h-3 w-3 text-[#4285F4] animate-pulse" aria-hidden="true" />
                  <span>Thinking...</span>
                </div>
              </div>
            )}

            {messages.length <= 2 && !busy && (
              <div className="pt-0.5 flex flex-wrap gap-1">
                {QUICK_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void askMela(q)}
                    className="text-left px-2.5 py-1 rounded-full bg-white/50 dark:bg-white/10 hover:bg-white/80 dark:hover:bg-white/20 border border-white/60 dark:border-white/15 text-[10.5px] font-medium text-[#202124] dark:text-white/95 cursor-pointer transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            <div ref={feedEndRef} />
          </div>

          {/* Morphic Input Bar */}
          <form
            onSubmit={handleSubmit}
            className="p-1.5 border-t border-white/35 dark:border-white/12 bg-white/30 dark:bg-black/25 backdrop-blur-md flex items-center gap-1.5 shrink-0"
          >
            <MessageCircle
              className="h-3.5 w-3.5 text-[#5F6368] dark:text-white/65 ml-1.5 shrink-0"
              aria-hidden="true"
            />
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask Mela..."
              aria-label="Ask Mela a question"
              className="flex-1 min-w-0 bg-transparent text-xs text-[#202124] dark:text-white placeholder:text-[#5F6368] dark:placeholder:text-white/55 focus:outline-none py-1"
            />
            <button
              type="submit"
              disabled={busy || !question.trim()}
              aria-label="Send question to Mela"
              className="h-8 w-8 inline-flex items-center justify-center rounded-full bg-[#1A73E8] hover:bg-[#1557B0] text-white disabled:opacity-45 cursor-pointer shrink-0 transition-colors"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
