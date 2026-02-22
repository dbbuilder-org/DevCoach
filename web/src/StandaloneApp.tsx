import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiClient } from '@ext/services/ApiClient'
import type { ChatContext, ProactiveTrigger, Session, WorkBlock } from '@ext/services/ApiClient'
import ConfigScreen, { loadConfig } from './ConfigScreen'
import type { DevCoachConfig } from './ConfigScreen'
import DashboardLayout from './DashboardLayout'

const STORAGE_KEY = 'dc_config'
const REPO_KEY = 'dc_current_repo'
const REPO_HISTORY_KEY = 'dc_repos'

function maybeAutoSeed(): DevCoachConfig | null {
  const pat = import.meta.env.VITE_PREFILL_PAT as string | undefined
  const anthropicKey = import.meta.env.VITE_PREFILL_ANTHROPIC_KEY as string | undefined
  const backendUrl = import.meta.env.VITE_PREFILL_BACKEND_URL as string | undefined
  const owner = import.meta.env.VITE_PREFILL_OWNER as string | undefined
  const repo = import.meta.env.VITE_PREFILL_REPO as string | undefined
  if (!pat || !anthropicKey) return null
  const seeded: DevCoachConfig = {
    backendUrl: backendUrl ?? 'https://devcoach-api.onrender.com',
    githubPat: pat, anthropicKey,
    owner: owner ?? '', repo: repo ?? '',
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
  return seeded
}

function loadRepoHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(REPO_HISTORY_KEY) ?? '[]') } catch { return [] }
}

function addToHistory(repo: string, current: string[]): string[] {
  return [repo, ...current.filter(r => r !== repo)].slice(0, 10)
}

export default function StandaloneApp() {
  const [config, setConfig] = useState<DevCoachConfig | null>(() => loadConfig() ?? maybeAutoSeed())
  const [showConfig, setShowConfig] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [currentBlock, setCurrentBlock] = useState<WorkBlock | null>(null)
  const [pendingProactiveMessage, setPendingProactiveMessage] = useState<{
    trigger: ProactiveTrigger; context: ChatContext
  } | null>(null)

  // ── Repo state ──────────────────────────────────────────────────────────────
  const defaultRepo = config ? `${config.owner}/${config.repo}` : ''

  const [currentRepo, setCurrentRepo] = useState<string>(() =>
    localStorage.getItem(REPO_KEY) || defaultRepo
  )
  const [repoHistory, setRepoHistory] = useState<string[]>(() => {
    const h = loadRepoHistory()
    // Seed history with the config default if it's not already there
    return defaultRepo && !h.includes(defaultRepo) ? [defaultRepo, ...h] : h
  })

  const handleRepoChange = useCallback((repo: string) => {
    setCurrentRepo(repo)
    localStorage.setItem(REPO_KEY, repo)
    setRepoHistory(prev => {
      const next = addToHistory(repo, prev)
      localStorage.setItem(REPO_HISTORY_KEY, JSON.stringify(next))
      return next
    })
    // Session is per-day (not per-repo) so we keep it; Queue and Chat context
    // update automatically because they receive the new repo prop.
  }, [])

  // ── ApiClient ───────────────────────────────────────────────────────────────
  const apiClient = useMemo(
    () => config ? new ApiClient(config.backendUrl, config.githubPat, config.anthropicKey) : null,
    [config]
  )

  useEffect(() => {
    if (!apiClient) return
    apiClient.getTodaySession()
      .then(s => { if (s) { setSession(s); setCurrentBlock(s.currentBlock) } })
      .catch(() => { /* no session yet */ })
  }, [apiClient])

  // ── Config save ─────────────────────────────────────────────────────────────
  const handleConfigSave = useCallback((saved: DevCoachConfig) => {
    setConfig(saved)
    const newDefault = `${saved.owner}/${saved.repo}`
    // Only switch current repo if user explicitly changed it in config
    if (!currentRepo || currentRepo === defaultRepo) {
      setCurrentRepo(newDefault)
      localStorage.setItem(REPO_KEY, newDefault)
    }
    setRepoHistory(prev => {
      const next = addToHistory(newDefault, prev)
      localStorage.setItem(REPO_HISTORY_KEY, JSON.stringify(next))
      return next
    })
    setShowConfig(false)
  }, [currentRepo, defaultRepo])

  // ── Proactive trigger ───────────────────────────────────────────────────────
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

  if (!config || showConfig) {
    return <ConfigScreen existing={config} onSave={handleConfigSave} />
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
      onOpenConfig={() => setShowConfig(true)}
    />
  )
}
