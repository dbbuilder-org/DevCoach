import React, { useState } from 'react'

export interface DevCoachConfig {
  backendUrl: string
  githubPat: string
  anthropicKey: string
  owner: string
  repo: string
}

const STORAGE_KEY = 'dc_config'
const DEFAULT_BACKEND = 'https://devcoach-api.onrender.com'

export function loadConfig(): DevCoachConfig | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as DevCoachConfig
  } catch {
    return null
  }
}

function maskSecret(value: string): string {
  if (value.length <= 4) return '****'
  return '••••••••' + value.slice(-4)
}

interface Props {
  existing: DevCoachConfig | null
  onSave: (config: DevCoachConfig) => void
}

export default function ConfigScreen({ existing, onSave }: Props) {
  const [backendUrl, setBackendUrl] = useState(existing?.backendUrl ?? DEFAULT_BACKEND)
  const [githubPat, setGithubPat] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [owner, setOwner] = useState(existing?.owner ?? '')
  const [repo, setRepo] = useState(existing?.repo ?? '')
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const pat = githubPat.trim() || existing?.githubPat || ''
    const key = anthropicKey.trim() || existing?.anthropicKey || ''

    if (!backendUrl.trim()) { setError('Backend URL is required.'); return }
    if (!pat) { setError('GitHub PAT is required.'); return }
    if (!key) { setError('Anthropic API Key is required.'); return }
    if (!owner.trim()) { setError('GitHub Owner is required.'); return }
    if (!repo.trim()) { setError('GitHub Repo is required.'); return }

    const config: DevCoachConfig = {
      backendUrl: backendUrl.trim(),
      githubPat: pat,
      anthropicKey: key,
      owner: owner.trim(),
      repo: repo.trim(),
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    onSave(config)
  }

  return (
    <div className="dc-setup-screen" style={{ padding: '24px', maxWidth: '480px', margin: '0 auto' }}>
      <div className="dc-setup-icon">🎓</div>
      <h2 style={{ marginBottom: '4px' }}>DevCoach Configuration</h2>
      <p style={{ color: 'var(--vscode-descriptionForeground)', marginBottom: '20px' }}>
        {existing ? 'Update your settings below.' : 'Enter your credentials to get started.'}
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <label className="dc-field">
          <span>Backend URL</span>
          <input
            className="dc-input"
            type="url"
            value={backendUrl}
            onChange={e => setBackendUrl(e.target.value)}
            placeholder={DEFAULT_BACKEND}
          />
        </label>

        <label className="dc-field">
          <span>GitHub PAT{existing?.githubPat ? ` (current: ${maskSecret(existing.githubPat)})` : ''}</span>
          <input
            className="dc-input"
            type="password"
            value={githubPat}
            onChange={e => setGithubPat(e.target.value)}
            placeholder={existing?.githubPat ? 'Leave blank to keep current' : 'ghp_...'}
            autoComplete="off"
          />
        </label>

        <label className="dc-field">
          <span>Anthropic API Key{existing?.anthropicKey ? ` (current: ${maskSecret(existing.anthropicKey)})` : ''}</span>
          <input
            className="dc-input"
            type="password"
            value={anthropicKey}
            onChange={e => setAnthropicKey(e.target.value)}
            placeholder={existing?.anthropicKey ? 'Leave blank to keep current' : 'sk-ant-...'}
            autoComplete="off"
          />
        </label>

        <label className="dc-field">
          <span>GitHub Owner</span>
          <input
            className="dc-input"
            type="text"
            value={owner}
            onChange={e => setOwner(e.target.value)}
            placeholder="dbbuilder-org"
          />
        </label>

        <label className="dc-field">
          <span>GitHub Repo</span>
          <input
            className="dc-input"
            type="text"
            value={repo}
            onChange={e => setRepo(e.target.value)}
            placeholder="DevCoach"
          />
        </label>

        {error && (
          <p style={{ color: 'var(--vscode-errorForeground)', margin: 0, fontSize: '12px' }}>
            {error}
          </p>
        )}

        <button type="submit" className="dc-btn dc-btn-primary" style={{ marginTop: '4px' }}>
          Save &amp; Connect
        </button>
      </form>
    </div>
  )
}
