import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiClient } from '@ext/services/ApiClient'
import type { ChatContext, ProactiveTrigger, Session, WorkBlock } from '@ext/services/ApiClient'
import ConfigScreen, { loadConfig } from './ConfigScreen'
import type { DevCoachConfig } from './ConfigScreen'
import DashboardLayout from './DashboardLayout'

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

export default function StandaloneApp() {
  const [config, setConfig] = useState<DevCoachConfig | null>(() => loadConfig() ?? maybeAutoSeed())
  const [showConfig, setShowConfig] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [currentBlock, setCurrentBlock] = useState<WorkBlock | null>(null)
  const [pendingProactiveMessage, setPendingProactiveMessage] = useState<{
    trigger: ProactiveTrigger
    context: ChatContext
  } | null>(null)

  // Build ApiClient synchronously so it's available on the same render
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
      .catch(() => { /* session not started yet */ })
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
  }, [session, currentBlock])

  if (!config || showConfig) {
    return (
      <ConfigScreen
        existing={config}
        onSave={handleConfigSave}
      />
    )
  }

  return (
    <DashboardLayout
      apiClient={apiClient}
      session={session}
      currentBlock={currentBlock}
      repo={`${config.owner}/${config.repo}`}
      pendingProactiveMessage={pendingProactiveMessage}
      onSessionChange={setSession}
      onBlockChange={setCurrentBlock}
      onProactiveTrigger={handleProactiveTrigger}
      onProactiveConsumed={() => setPendingProactiveMessage(null)}
      onOpenConfig={() => setShowConfig(true)}
    />
  )
}
