import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient, ChatContext, ProactiveTrigger, Session, WorkBlock } from '../../services/ApiClient';
import { useConversation } from '../hooks/useConversation';

interface ChatPanelProps {
  apiClient: ApiClient | null;
  session: Session | null;
  currentBlock: WorkBlock | null;
  pendingProactiveMessage?: { trigger: ProactiveTrigger; context: ChatContext } | null;
  onProactiveConsumed?: () => void;
}

const SUGGESTED_PROMPTS = [
  'Why am I stuck?',
  'Help me plan this',
  'What could break?',
  "What's next?",
];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const TRIGGER_LABELS: Record<string, string> = {
  pomodoro_complete: '🍅 Pomodoro complete',
  phase_change: '🔄 Phase changed',
  stuck_signal: '😶 Stuck signal detected',
  day_start: '☀️ Day started',
  day_end: '🌙 Day ended',
};

export default function ChatPanel({ apiClient, session, currentBlock, pendingProactiveMessage, onProactiveConsumed }: ChatPanelProps) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { messages, loading, sendMessage, triggerProactive } = useConversation(apiClient, session?.id ?? null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Drain pending proactive message when it arrives
  useEffect(() => {
    if (pendingProactiveMessage) {
      triggerProactive(pendingProactiveMessage.trigger, pendingProactiveMessage.context);
      onProactiveConsumed?.();
    }
  }, [pendingProactiveMessage]);

  const handleSend = useCallback(async () => {
    if (!inputText.trim() || loading) return;
    const context: ChatContext = {};
    if (currentBlock) {
      context.currentItem = {
        id: currentBlock.itemRef.number as number ?? 0,
        type: (currentBlock.itemRef.type as string === 'pull_request' ? 'pr' : 'issue') as 'issue' | 'pr',
        title: currentBlock.itemRef.title as string ?? '',
        url: currentBlock.itemRef.url as string ?? '',
        difficulty: 3,
        storyPoints: null,
        assignedToMe: false,
        needsReview: false,
        ageHours: 0,
        confidenceScore: 0,
        labels: [],
        priority: 'normal',
        explanation: null,
      };
      context.currentPhase = currentBlock.phase;
    }
    await sendMessage(inputText, context);
    setInputText('');
  }, [inputText, loading, sendMessage, currentBlock]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestedPrompt = (prompt: string) => {
    setInputText(prompt);
    inputRef.current?.focus();
  };

  const noSession = !session;

  return (
    <div className="dc-chat">
      {/* Messages area */}
      <div className="dc-chat__messages">
        {messages.length === 0 && !noSession && (
          <div className="dc-chat__empty">
            <p>Ask your coach anything — strategy, debugging, planning, or just a sanity check.</p>
          </div>
        )}

        {noSession && (
          <div className="dc-chat__empty">
            <p>Start your day to unlock the coaching conversation.</p>
          </div>
        )}

        {messages.map(msg => {
          if (msg.role === 'system') {
            return (
              <div key={msg.id} className="dc-chat__system-msg">
                {msg.trigger ? TRIGGER_LABELS[msg.trigger] ?? '💡' : '💡'} {msg.content}
              </div>
            );
          }

          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`dc-chat__bubble dc-chat__bubble--${isUser ? 'user' : 'assistant'}`}
            >
              <div className="dc-chat__bubble-content">{msg.content}</div>
              <div className="dc-chat__bubble-time">{formatTime(msg.timestamp)}</div>
            </div>
          );
        })}

        {loading && (
          <div className="dc-chat__bubble dc-chat__bubble--assistant">
            <div className="dc-chat__typing">
              <span /><span /><span />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested prompts */}
      {!noSession && (
        <div className="dc-chat__suggestions">
          {SUGGESTED_PROMPTS.map(p => (
            <button
              key={p}
              className="dc-chip"
              onClick={() => handleSuggestedPrompt(p)}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="dc-chat__input-row">
        <textarea
          ref={inputRef}
          className="dc-chat__input"
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={noSession ? 'Start your day to chat...' : 'Ask your coach... (Enter to send)'}
          disabled={noSession || loading}
          rows={2}
        />
        <button
          className="dc-btn dc-btn-primary"
          onClick={handleSend}
          disabled={noSession || loading || !inputText.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
