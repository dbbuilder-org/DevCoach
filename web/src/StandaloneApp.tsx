import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiClient } from '@ext/services/ApiClient'
import type { ChatContext, ProactiveTrigger, Session, WorkBlock, QueueItem } from '@ext/services/ApiClient'
import TodayPanel from '@ext/webview/components/TodayPanel'
import QueuePanel from '@ext/webview/components/QueuePanel'
import ChatPanel from '@ext/webview/components/ChatPanel'
import ChartsPanel from '@ext/webview/components/ChartsPanel'
import PuzzlePanel from '@ext/webview/components/PuzzlePanel'
import ConfigScreen, { loadConfig } from './ConfigScreen'
import type { DevCoachConfig } from './ConfigScreen'

const STORAGE_KEY = 'dc_config'

// If Vite build-time env vars are present and no config is saved yet, seed
// localStorage so the user lands directly in the app without the config form.
function maybeAutoSeed(): DevCoachConfig | null {
  const pat = import.meta.env.VITE_PREFILL_PAT as string | undefined
  const anthropicKey = import.meta.env.VITE_PREFILL_ANTHROPIC_KEY as string | undefined
  const backendUrl = import.meta.env.VITE_PREFILL_BACKEND_URL as string | undefined
  const owner = import.meta.env.VITE_PREFILL_OWNER as string | undefined
  const repo = import.meta.env.VITE_PREFILL_REPO as string | undefined

  if (!pat || !anthropicKey) return null

  const seeded: DevCoachConfig = {
    backendUrl: backendUrl ?? 'https://devcoach-api.onrender.com',
    githubPat: pat,
    anthropicKey,
    owner: owner ?? '',
    repo: repo ?? '',
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
  return seeded
}

type Tab = 'today' | 'queue' | 'chat' | 'charts' | 'puzzle'

const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'queue', label: 'Queue' },
  { id: 'chat', label: 'Chat' },
  { id: 'charts', label: 'Charts' },
  { id: 'puzzle', label: 'Puzzle' },
]

export default function StandaloneApp() {
  const [config, setConfig] = useState<DevCoachConfig | null>(() => loadConfig() ?? maybeAutoSeed())
  const [showConfig, setShowConfig] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('today')
  const [session, setSession] = useState<Session | null>(null)
  const [currentBlock, setCurrentBlock] = useState<WorkBlock | null>(null)
  const [pendingProactiveMessage, setPendingProactiveMessage] = useState<{
    trigger: ProactiveTrigger
    context: ChatContext
  } | null>(null)

  // Build ApiClient synchronously whenever config changes so it's available on the same render
  const apiClient = useMemo(
    () => config ? new ApiClient(config.backendUrl, config.githubPat, config.anthropicKey) : null,
    [config]
  )
  useEffect(() => {
    if (!apiClient) return
    apiClient.getTodaySession()
      .then(s => {
        if (s) {
          setSession(s)
          setCurrentBlock(s.currentBlock)
        }
      })
      .catch(() => { /* session not started yet — that's fine */ })
  }, [apiClient])

  const handleConfigSave = useCallback((saved: DevCoachConfig) => {
    setConfig(saved)
    setShowConfig(false)
  }, [])

  const handleProactiveTrigger = useCallback((
    trigger: ProactiveTrigger,
    extraContext?: Record<string, unknown>
  ) => {
    if (!session) return
    const context: ChatContext = {
      currentPhase: currentBlock?.phase,
      ...(extraContext as Partial<ChatContext> ?? {}),
    }
    setPendingProactiveMessage({ trigger, context })
    setActiveTab('chat')
  }, [session, currentBlock])

  // No config — show setup screen
  if (!config || showConfig) {
    return (
      <ConfigScreen
        existing={config}
        onSave={handleConfigSave}
      />
    )
  }

  const effectiveRepo = `${config.owner}/${config.repo}`

  return (
    <div className="dc-app">
      {/* Header */}
      <div className="dc-app-header" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 12px',
        background: 'var(--vscode-editorGroupHeader-tabsBackground)',
        borderBottom: '1px solid var(--vscode-editorWidget-border)',
      }}>
        <span style={{ fontWeight: 600, fontSize: '13px' }}>DevCoach</span>
        <button
          onClick={() => setShowConfig(true)}
          title="Configure"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--vscode-descriptionForeground)',
            fontSize: '16px',
            padding: '2px 4px',
            lineHeight: 1,
          }}
        >
          ⚙
        </button>
      </div>

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
              if (!apiClient || !session) return
              try {
                const block = await apiClient.startWorkBlock(session.id, item)
                setCurrentBlock(block)
                setSession(prev => prev ? { ...prev, currentBlock: block } : prev)
              } catch {
                // non-fatal — TodayPanel will show the error
              }
              setActiveTab('today')
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
  )
}
