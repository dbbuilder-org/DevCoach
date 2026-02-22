import { useState, useCallback } from 'react';
import type { ApiClient, Session, WorkBlock, QueueItem, Phase } from '../../services/ApiClient';

interface UseSessionReturn {
  session: Session | null;
  currentBlock: WorkBlock | null;
  loading: boolean;
  error: string | null;
  startSession: (owner: string, repo: string) => Promise<void>;
  endSession: (feedback: string) => Promise<void>;
  startBlock: (item: QueueItem) => Promise<void>;
  updatePhase: (phase: Phase) => Promise<void>;
  endBlock: (notes: string) => Promise<void>;
  refreshSession: () => Promise<void>;
}

export function useSession(apiClient: ApiClient | null): UseSessionReturn {
  const [session, setSession] = useState<Session | null>(null);
  const [currentBlock, setCurrentBlock] = useState<WorkBlock | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startSession = useCallback(async (owner: string, repo: string) => {
    if (!apiClient) return;
    setLoading(true);
    setError(null);
    try {
      const newSession = await apiClient.startSession(owner, repo);
      setSession(newSession);
      setCurrentBlock(newSession.currentBlock);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  const endSession = useCallback(async (feedback: string) => {
    if (!apiClient || !session) return;
    setLoading(true);
    setError(null);
    try {
      await apiClient.endSession(session.id, feedback);
      setSession(null);
      setCurrentBlock(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiClient, session]);

  const startBlock = useCallback(async (item: QueueItem) => {
    if (!apiClient || !session) return;
    setLoading(true);
    setError(null);
    try {
      const block = await apiClient.startWorkBlock(session.id, item);
      setCurrentBlock(block);
      setSession(prev => prev ? { ...prev, currentBlock: block } : prev);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiClient, session]);

  const updatePhase = useCallback(async (phase: Phase) => {
    if (!apiClient || !session || !currentBlock) return;
    setLoading(true);
    setError(null);
    try {
      await apiClient.updateBlockPhase(session.id, currentBlock.id, phase);
      setCurrentBlock(prev => prev ? { ...prev, phase } : prev);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiClient, session, currentBlock]);

  const endBlock = useCallback(async (notes: string) => {
    if (!apiClient || !session || !currentBlock) return;
    setLoading(true);
    setError(null);
    try {
      await apiClient.endWorkBlock(session.id, currentBlock.id, notes);
      setCurrentBlock(null);
      setSession(prev => prev ? { ...prev, currentBlock: null } : prev);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiClient, session, currentBlock]);

  const refreshSession = useCallback(async () => {
    if (!apiClient) return;
    setLoading(true);
    setError(null);
    try {
      const todaySession = await apiClient.getTodaySession();
      setSession(todaySession);
      setCurrentBlock(todaySession?.currentBlock ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  return {
    session,
    currentBlock,
    loading,
    error,
    startSession,
    endSession,
    startBlock,
    updatePhase,
    endBlock,
    refreshSession,
  };
}
