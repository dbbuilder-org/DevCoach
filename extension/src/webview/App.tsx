import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClient } from '../services/ApiClient';
import type { ChatContext, ProactiveTrigger, Session, WorkBlock, QueueItem } from '../services/ApiClient';
import TodayPanel from './components/TodayPanel';
import QueuePanel from './components/QueuePanel';
import ChatPanel from './components/ChatPanel';
import ChartsPanel from './components/ChartsPanel';
import PuzzlePanel from './components/PuzzlePanel';

// VS Code webview API — available after the bundle loads inside the webview
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

type Tab = 'today' | 'queue' | 'chat' | 'charts' | 'puzzle';

interface AppState {
  backendUrl: string;
  defaultRepo: string;
  detectedOwner: string | null;
  detectedRepo: string | null;
  githubPat: string | null;
  anthropicKey: string | null;
  initialized: boolean;
  secretsReceived: boolean;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'queue', label: 'Queue' },
  { id: 'chat', label: 'Chat' },
  { id: 'charts', label: 'Charts' },
  { id: 'puzzle', label: 'Puzzle' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('today');
  const [appState, setAppState] = useState<AppState>({
    backendUrl: 'http://localhost:8000',
    defaultRepo: '',
    detectedOwner: null,
    detectedRepo: null,
    githubPat: null,
    anthropicKey: null,
    initialized: false,
    secretsReceived: false,
  });

  const [session, setSession] = useState<Session | null>(null);
  const [currentBlock, setCurrentBlock] = useState<WorkBlock | null>(null);
  const [pendingProactiveMessage, setPendingProactiveMessage] = useState<{
    trigger: ProactiveTrigger;
    context: ChatContext;
  } | null>(null);

  const apiClientRef = useRef<ApiClient | null>(null);

  // Build ApiClient once we have backendUrl + githubPat
  useEffect(() => {
    if (appState.backendUrl && appState.githubPat) {
      apiClientRef.current = new ApiClient(appState.backendUrl, appState.githubPat);
    }
  }, [appState.backendUrl, appState.githubPat]);

  // Load today's session on startup once apiClient is ready
  const apiClient = apiClientRef.current;
  useEffect(() => {
    if (!apiClient) return;
    apiClient.getTodaySession()
      .then(s => {
        if (s) {
          setSession(s);
          setCurrentBlock(s.currentBlock);
        }
      })
      .catch(() => {/* session not started yet — that's fine */});
  }, [apiClient]);

  // Listen for messages from the extension host
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data as { type: string; data?: Record<string, unknown> };
      switch (msg.type) {
        case 'init':
          setAppState(prev => ({
            ...prev,
            backendUrl: (msg.data?.backendUrl as string) ?? prev.backendUrl,
            defaultRepo: (msg.data?.defaultRepo as string) ?? prev.defaultRepo,
            detectedOwner: (msg.data?.detectedOwner as string | null) ?? null,
            detectedRepo: (msg.data?.detectedRepo as string | null) ?? null,
            initialized: true,
          }));
          // Now request secrets
          vscode.postMessage({ type: 'getSecrets' });
          break;

        case 'secrets':
          setAppState(prev => ({
            ...prev,
            githubPat: (msg.data?.githubPat as string | null) ?? null,
            anthropicKey: (msg.data?.anthropicKey as string | null) ?? null,
            secretsReceived: true,
          }));
          break;

        case 'startDay':
          setActiveTab('today');
          break;

        case 'startWorkBlock':
          setActiveTab('queue');
          break;

        case 'endWorkBlock':
          setActiveTab('today');
          break;
      }
    };

    window.addEventListener('message', handler);
    // Signal to extension that the webview is ready
    vscode.postMessage({ type: 'ready' });

    return () => window.removeEventListener('message', handler);
  }, []);

  const handleProactiveTrigger = useCallback((
    trigger: ProactiveTrigger,
    extraContext?: Record<string, unknown>
  ) => {
    if (!session) return;
    const context: ChatContext = {
      currentPhase: currentBlock?.phase,
      ...(extraContext as Partial<ChatContext> ?? {}),
    };
    setPendingProactiveMessage({ trigger, context });
    setActiveTab('chat');
  }, [session, currentBlock]);

  const needsConfig = appState.secretsReceived && (!appState.githubPat || !appState.anthropicKey);

  if (!appState.initialized || !appState.secretsReceived) {
    return (
      <div className="dc-loading-screen">
        <div className="dc-spinner" />
        <p>Loading DevCoach...</p>
      </div>
    );
  }

  if (needsConfig) {
    return (
      <div className="dc-setup-screen">
        <div className="dc-setup-icon">🎓</div>
        <h2>Welcome to DevCoach</h2>
        <p>Configure your API keys to get started.</p>
        <button
          className="dc-btn dc-btn-primary"
          onClick={() => vscode.postMessage({ type: 'configure' })}
        >
          Configure API Keys
        </button>
      </div>
    );
  }

  // Compute effective repo string: prefer detected owner/repo, fall back to defaultRepo
  const effectiveRepo =
    appState.detectedOwner && appState.detectedRepo
      ? `${appState.detectedOwner}/${appState.detectedRepo}`
      : appState.defaultRepo;

  return (
    <div className="dc-app">
      {/* Tab bar */}
      <nav className="dc-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`dc-tab${activeTab === tab.id ? ' dc-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Tab panels */}
      <main className="dc-main">
        {activeTab === 'today' && (
          <TodayPanel
            apiClient={apiClient}
            session={session}
            currentBlock={currentBlock}
            repo={effectiveRepo}
            onSessionChange={setSession}
            onBlockChange={setCurrentBlock}
            onProactiveTrigger={handleProactiveTrigger}
          />
        )}
        {activeTab === 'queue' && (
          <QueuePanel
            apiClient={apiClient}
            session={session}
            repo={effectiveRepo}
            onStartBlock={async (item: QueueItem) => {
              if (!apiClient || !session) return;
              try {
                const block = await apiClient.startWorkBlock(session.id, item);
                setCurrentBlock(block);
                setSession(prev => prev ? { ...prev, currentBlock: block } : prev);
              } catch {
                // non-fatal — TodayPanel will show the error
              }
              setActiveTab('today');
            }}
          />
        )}
        {activeTab === 'chat' && (
          <ChatPanel
            apiClient={apiClient}
            session={session}
            currentBlock={currentBlock}
            pendingProactiveMessage={pendingProactiveMessage}
            onProactiveConsumed={() => setPendingProactiveMessage(null)}
          />
        )}
        {activeTab === 'charts' && (
          <ChartsPanel apiClient={apiClient} />
        )}
        {activeTab === 'puzzle' && (
          <PuzzlePanel apiClient={apiClient} />
        )}
      </main>
    </div>
  );
}
