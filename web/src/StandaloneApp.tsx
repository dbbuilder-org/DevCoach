import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { SignIn, useAuth, useUser } from '@clerk/clerk-react'
import { ApiClient } from '@ext/services/ApiClient'
import type { ChatContext, ProactiveTrigger, Session, WorkBlock } from '@ext/services/ApiClient'
import SettingsScreen from './SettingsScreen'
import DashboardLayout from './DashboardLayout'

const BACKEND_URL =
  (import.meta.env.VITE_PREFILL_BACKEND_URL as string | undefined) ??
  'https://devcoach-api.onrender.com'

const DEFAULT_REPO =
  (import.meta.env.VITE_PREFILL_OWNER as string | undefined) &&
  (import.meta.env.VITE_PREFILL_REPO as string | undefined)
    ? `${import.meta.env.VITE_PREFILL_OWNER}/${import.meta.env.VITE_PREFILL_REPO}`
    : ''

const REPO_KEY = 'dc_current_repo'
const REPO_HISTORY_KEY = 'dc_repos'

function loadRepoHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(REPO_HISTORY_KEY) ?? '[]') } catch { return [] }
}

function addToHistory(repo: string, current: string[]): string[] {
  return [repo, ...current.filter(r => r !== repo)].slice(0, 10)
}

export default function StandaloneApp() {
  const { isLoaded, isSignedIn } = useUser()
  const { getToken } = useAuth()

  const [showSettings, setShowSettings] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [currentBlock, setCurrentBlock] = useState<WorkBlock | null>(null)
  const [pendingProactiveMessage, setPendingProactiveMessage] = useState<{
    trigger: ProactiveTrigger; context: ChatContext
  } | null>(null)

  // ── Repo state ─────────────────────────────────────────────────────────────
  const [currentRepo, setCurrentRepo] = useState<string>(() =>
    localStorage.getItem(REPO_KEY) || DEFAULT_REPO
  )
  const [repoHistory, setRepoHistory] = useState<string[]>(() => {
    const h = loadRepoHistory()
    return DEFAULT_REPO && !h.includes(DEFAULT_REPO) ? [DEFAULT_REPO, ...h] : h
  })

  const handleRepoChange = useCallback((repo: string) => {
    setCurrentRepo(repo)
    localStorage.setItem(REPO_KEY, repo)
    setRepoHistory(prev => {
      const next = addToHistory(repo, prev)
      localStorage.setItem(REPO_HISTORY_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  // ── ApiClient — uses Clerk session JWT as the Bearer token ─────────────────
  const apiClient = useMemo(
    () => isSignedIn ? new ApiClient(BACKEND_URL, () => getToken()) : null,
    [isSignedIn, getToken]
  )

  // ── Fetch today's session once signed in ───────────────────────────────────
  useEffect(() => {
    if (!apiClient) return
    apiClient.getTodaySession()
      .then(s => { if (s) { setSession(s); setCurrentBlock(s.currentBlock) } })
      .catch(() => { /* no session yet */ })
  }, [apiClient])

  // ── Proactive trigger ──────────────────────────────────────────────────────
  const handleProactiveTrigger = useCallback((
    trigger: ProactiveTrigger,
    extraContext?: Record<string, unknown>
  ) => {
    if (!session) return
    setPendingProactiveMessage({
      trigger,
      context: {
        currentPhase: currentBlock?.phase,
        ...(extraContext as Partial<ChatContext> ?? {}),
      },
    })
  }, [session, currentBlock])

  // ── Loading ────────────────────────────────────────────────────────────────
  if (!isLoaded) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--vscode-editor-background)',
        color: 'var(--vscode-descriptionForeground)', fontSize: 13,
      }}>
        Loading…
      </div>
    )
  }

  // ── Sign-in ────────────────────────────────────────────────────────────────
  if (!isSignedIn) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--vscode-editor-background)',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🎓</div>
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>DevCoach</div>
          <div style={{ color: 'var(--vscode-descriptionForeground)', fontSize: 12, marginBottom: 24 }}>
            Sign in with GitHub to start coaching
          </div>
          <SignIn />
        </div>
      </div>
    )
  }

  // ── Settings overlay ───────────────────────────────────────────────────────
  if (showSettings) {
    return (
      <SettingsScreen
        currentRepo={currentRepo}
        onSave={(repo) => { handleRepoChange(repo); setShowSettings(false) }}
        onCancel={() => setShowSettings(false)}
      />
    )
  }

  return (
    <DashboardLayout
      apiClient={apiClient}
      session={session}
      currentBlock={currentBlock}
      currentRepo={currentRepo}
      repoHistory={repoHistory}
      pendingProactiveMessage={pendingProactiveMessage}
      onSessionChange={setSession}
      onBlockChange={setCurrentBlock}
      onProactiveTrigger={handleProactiveTrigger}
      onProactiveConsumed={() => setPendingProactiveMessage(null)}
      onRepoChange={handleRepoChange}
      onOpenConfig={() => setShowSettings(true)}
    />
  )
}
