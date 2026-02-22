import React, { useRef, useState } from 'react'

interface Props {
  current: string         // "owner/repo"
  history: string[]       // recent repos excluding current
  onSelect: (repo: string) => void
}

export default function RepoPicker({ current, history, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const close = () => { setOpen(false); setInput('') }

  const pick = (repo: string) => { onSelect(repo); close() }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const val = input.trim()
    if (!val.includes('/')) return
    pick(val)
  }

  const suggestions = history.filter(r => r !== current).slice(0, 8)

  return (
    <div style={{ position: 'relative' }}>
      {/* Trigger */}
      <button
        onClick={() => {
          setOpen(o => !o)
          if (!open) setTimeout(() => inputRef.current?.focus(), 60)
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: 'var(--vscode-input-background)',
          border: '1px solid var(--vscode-editorWidget-border)',
          borderRadius: 4,
          color: 'var(--vscode-editor-foreground)',
          cursor: 'pointer', fontSize: 12,
          padding: '3px 9px',
          maxWidth: 260,
        }}
      >
        <span style={{ opacity: 0.45, fontSize: 10, flexShrink: 0 }}>repo</span>
        <span style={{
          fontFamily: 'var(--vscode-editor-font-family)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          maxWidth: 200,
        }}>
          {current}
        </span>
        <span style={{ opacity: 0.4, fontSize: 9, flexShrink: 0, marginLeft: 2 }}>▾</span>
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={close} />

          {/* Dropdown */}
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0,
            background: 'var(--vscode-editorWidget-background)',
            border: '1px solid var(--vscode-editorWidget-border)',
            borderRadius: 7,
            boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
            zIndex: 100, minWidth: 260, maxWidth: 340,
            overflow: 'hidden',
          }}>

            {/* Active */}
            <div style={{ padding: '6px 12px 2px', fontSize: 10, opacity: 0.45, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Active
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '6px 12px 8px',
              background: 'var(--vscode-list-hoverBackground)',
              fontSize: 12, fontFamily: 'var(--vscode-editor-font-family)',
            }}>
              <span style={{ color: 'var(--vscode-terminal-ansiGreen)', fontSize: 10 }}>●</span>
              {current}
            </div>

            {/* Recent */}
            {suggestions.length > 0 && (
              <>
                <div style={{
                  borderTop: '1px solid var(--vscode-editorWidget-border)',
                  padding: '6px 12px 2px', fontSize: 10, opacity: 0.45,
                  textTransform: 'uppercase', letterSpacing: '0.07em',
                }}>
                  Recent
                </div>
                {suggestions.map(repo => (
                  <button
                    key={repo}
                    onClick={() => pick(repo)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      width: '100%', textAlign: 'left',
                      padding: '6px 12px',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--vscode-editor-foreground)',
                      fontSize: 12, fontFamily: 'var(--vscode-editor-font-family)',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <span style={{ opacity: 0.3, fontSize: 10 }}>○</span>
                    {repo}
                  </button>
                ))}
              </>
            )}

            {/* Switch to new repo */}
            <div style={{
              borderTop: '1px solid var(--vscode-editorWidget-border)',
              padding: '8px 12px 10px',
            }}>
              <div style={{ fontSize: 10, opacity: 0.45, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
                Switch to
              </div>
              <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 6 }}>
                <input
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="owner/repo"
                  className="dc-input"
                  style={{ flex: 1, fontSize: 12, padding: '4px 8px' }}
                />
                <button
                  type="submit"
                  className="dc-btn dc-btn-primary"
                  style={{ padding: '4px 10px', fontSize: 12 }}
                  disabled={!input.includes('/')}
                >
                  Go
                </button>
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
