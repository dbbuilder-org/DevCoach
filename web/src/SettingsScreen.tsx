import React, { useState } from 'react'
import { UserButton, useUser } from '@clerk/clerk-react'

interface Props {
  currentRepo: string
  onSave: (repo: string) => void
  onCancel: () => void
}

export default function SettingsScreen({ currentRepo, onSave, onCancel }: Props) {
  const { user } = useUser()
  const [repo, setRepo] = useState(currentRepo)
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const val = repo.trim()
    if (!val.includes('/')) { setError('Format must be owner/repo'); return }
    onSave(val)
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--vscode-editor-background)',
    }}>
      <div style={{ width: 380, padding: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 2 }}>Settings</div>
            <div style={{ fontSize: 12, color: 'var(--vscode-descriptionForeground)' }}>
              Signed in as {user?.primaryEmailAddress?.emailAddress ?? user?.username}
            </div>
          </div>
          <UserButton />
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label className="dc-field">
            <span>Default Repository</span>
            <input
              className="dc-input"
              type="text"
              value={repo}
              onChange={e => setRepo(e.target.value)}
              placeholder="owner/repo"
            />
          </label>

          {error && (
            <p style={{ color: 'var(--vscode-errorForeground)', margin: 0, fontSize: 12 }}>
              {error}
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="submit" className="dc-btn dc-btn-primary" style={{ flex: 1 }}>
              Save
            </button>
            <button type="button" className="dc-btn dc-btn-ghost" onClick={onCancel} style={{ flex: 1 }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
