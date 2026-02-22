import { useState, useCallback, useEffect } from 'react';
import type { ApiClient, Message, ChatContext, ProactiveTrigger } from '../../services/ApiClient';

let messageIdCounter = 0;
function makeId(): string {
  return `local-${++messageIdCounter}`;
}

interface UseConversationReturn {
  messages: Message[];
  loading: boolean;
  sendMessage: (text: string, context?: ChatContext) => Promise<void>;
  triggerProactive: (trigger: ProactiveTrigger, context: ChatContext) => Promise<void>;
  clearHistory: () => void;
}

export function useConversation(
  apiClient: ApiClient | null,
  sessionId: string | null
): UseConversationReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  // Load conversation history when sessionId changes
  useEffect(() => {
    if (!apiClient || !sessionId) {
      setMessages([]);
      return;
    }

    apiClient.getConversationHistory(sessionId).then(history => {
      setMessages(history);
    }).catch(() => {
      // If history fails to load, start fresh — non-fatal
    });
  }, [apiClient, sessionId]);

  const sendMessage = useCallback(async (text: string, context: ChatContext = {}) => {
    if (!apiClient || !sessionId || !text.trim()) return;

    const userMsg: Message = {
      id: makeId(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const reply = await apiClient.chat(sessionId, text, context);
      const assistantMsg: Message = {
        id: makeId(),
        role: 'assistant',
        content: reply,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const errMsg: Message = {
        id: makeId(),
        role: 'system',
        content: `Error: ${(err as Error).message}`,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  }, [apiClient, sessionId]);

  const triggerProactive = useCallback(async (trigger: ProactiveTrigger, context: ChatContext) => {
    if (!apiClient || !sessionId) return;

    setLoading(true);
    try {
      const content = await apiClient.getProactiveMessage(sessionId, trigger, context);
      const proactiveMsg: Message = {
        id: makeId(),
        role: 'assistant',
        content,
        timestamp: new Date().toISOString(),
        trigger,
      };
      setMessages(prev => [...prev, proactiveMsg]);
    } catch {
      // Proactive messages are best-effort — silently ignore failures
    } finally {
      setLoading(false);
    }
  }, [apiClient, sessionId]);

  const clearHistory = useCallback(() => {
    setMessages([]);
  }, []);

  return { messages, loading, sendMessage, triggerProactive, clearHistory };
}
