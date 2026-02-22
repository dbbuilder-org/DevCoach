import React, { useEffect, useRef, useState } from 'react'
import { UserButton } from '@clerk/clerk-react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import type {
  ApiClient, ChatContext, ProactiveTrigger, QueueItem, Session, WorkBlock,
} from '@ext/services/ApiClient'
import TodayPanel from '@ext/webview/components/TodayPanel'
import QueuePanel from '@ext/webview/components/QueuePanel'
import ChatPanel from '@ext/webview/components/ChatPanel'
import ChartsPanel from '@ext/webview/components/ChartsPanel'
import PuzzlePanel from '@ext/webview/components/PuzzlePanel'
import RepoPicker from './RepoPicker'

// ── Narrow-mode detection ────────────────────────────────────────────────────
// Below this width we switch to a single vertical stack (portrait mode).
const PORTRAIT_BREAKPOINT = 700

function useIsNarrow() {
  const [narrow, setNarrow] = useState(() => window.innerWidth < PORTRAIT_BREAKPOINT)
  useEffect(() => {
    const update = () => setNarrow(window.innerWidth < PORTRAIT_BREAKPOINT)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return narrow
}

// ── Types ────────────────────────────────────────────────────────────────────
type LeftPanelId = 'today' | 'queue' | 'charts'

const PANEL_LABELS: Record<LeftPanelId, string> = {
  today: 'Today',
  queue: 'Queue',
  charts: 'Velocity',
}

interface Props {
  apiClient: ApiClient | null
  session: Session | null
  currentBlock: WorkBlock | null
  currentRepo: string
  repoHistory: string[]
  pendingProactiveMessage: { trigger: ProactiveTrigger; context: ChatContext } | null
  onSessionChange: (s: Session | null) => void
  onBlockChange: (b: WorkBlock | null) => void
  onProactiveTrigger: (trigger: ProactiveTrigger, context?: Record<string, unknown>) => void
  onProactiveConsumed: () => void
  onRepoChange: (repo: string) => void
  onOpenConfig: () => void
}

// ── Shared panel-title-bar ───────────────────────────────────────────────────
function PanelBar({
  id, label, subtitle, onDragStart, onDragOver, onDrop,
}: {
  id: LeftPanelId | 'chat'
  label: string
  subtitle?: string | null
  onDragStart?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: () => void
}) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '3px 10px',
        background: 'var(--vscode-editorGroupHeader-tabsBackground)',
        borderBottom: '1px solid var(--vscode-editorWidget-border)',
        flexShrink: 0, userSelect: 'none',
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {onDragStart && (
        <span
          draggable
          onDragStart={e => { e.stopPropagation(); onDragStart() }}
          style={{ cursor: 'grab', opacity: 0.45, fontSize: 15, lineHeight: 1, marginRight: 2 }}
          title="Drag to reorder"
        >
          ⠿
        </span>
      )}
      <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', opacity: 0.65 }}>
        {label}
      </span>
      {subtitle && (
        <span style={{
          fontSize: 10, opacity: 0.4,
          fontFamily: 'var(--vscode-editor-font-family)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          maxWidth: 180,
        }}>
          {subtitle}
        </span>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function DashboardLayout({
  apiClient, session, currentBlock, currentRepo, repoHistory,
  pendingProactiveMessage, onSessionChange, onBlockChange,
  onProactiveTrigger, onProactiveConsumed, onRepoChange, onOpenConfig,
}: Props) {
  const isNarrow = useIsNarrow()
  const [panelOrder, setPanelOrder] = useState<LeftPanelId[]>(['today', 'queue', 'charts'])
  const [showPuzzle, setShowPuzzle] = useState(true)
  const dragSource = useRef<LeftPanelId | null>(null)

  const handleDrop = (targetId: LeftPanelId) => {
    const src = dragSource.current
    if (!src || src === targetId) return
    setPanelOrder(prev => {
      const next = [...prev]
      next.splice(next.indexOf(src), 1)
      next.splice(next.indexOf(targetId), 0, src)
      return next
    })
    dragSource.current = null
  }

  const panelSubtitle = (id: LeftPanelId | 'chat') => {
    if (id === 'charts') return 'all repos'
    return currentRepo
  }

  // ── Panel content renderers ────────────────────────────────────────────────
  const renderLeft = (id: LeftPanelId) => {
    switch (id) {
      case 'today':
        return (
          <TodayPanel
            apiClient={apiClient} session={session} currentBlock={currentBlock}
            repo={currentRepo} onSessionChange={onSessionChange}
            onBlockChange={onBlockChange} onProactiveTrigger={onProactiveTrigger}
          />
        )
      case 'queue':
        return (
          <QueuePanel
            apiClient={apiClient} session={session} repo={currentRepo}
            onStartBlock={async (item: QueueItem) => {
              if (!apiClient || !session) return
              try {
                const block = await apiClient.startWorkBlock(session.id, item)
                onBlockChange(block)
                onSessionChange({ ...session, currentBlock: block })
              } catch { /* non-fatal */ }
            }}
          />
        )
      case 'charts':
        return <ChartsPanel apiClient={apiClient} />
    }
  }

  const chatPanel = (
    <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
      <ChatPanel
        apiClient={apiClient} session={session} currentBlock={currentBlock}
        pendingProactiveMessage={pendingProactiveMessage}
        onProactiveConsumed={onProactiveConsumed}
      />
    </div>
  )

  // ── Shared puzzle overlay ─────────────────────────────────────────────────
  const puzzleOverlay = showPuzzle && (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(2px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--vscode-editorWidget-background)',
        border: '1px solid var(--vscode-editorWidget-border)',
        borderRadius: 10,
        width: 'min(680px, 92vw)', maxHeight: '88vh', overflow: 'auto',
        boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 0' }}>
          <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5 }}>
            Morning Warm-Up
          </span>
          <button onClick={() => setShowPuzzle(false)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vscode-descriptionForeground)', fontSize: 18, lineHeight: 1, padding: '2px 4px' }}>
            ✕
          </button>
        </div>
        <PuzzlePanel apiClient={apiClient} />
        <div style={{ padding: '0 16px 16px', textAlign: 'center' }}>
          <button className="dc-btn dc-btn-ghost" onClick={() => setShowPuzzle(false)} style={{ fontSize: 12 }}>
            Skip — Start Work
          </button>
        </div>
      </div>
    </div>
  )

  // ── Shared header ─────────────────────────────────────────────────────────
  const header = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '5px 12px',
      background: 'var(--vscode-editorGroupHeader-tabsBackground)',
      borderBottom: '1px solid var(--vscode-editorWidget-border)',
      flexShrink: 0, zIndex: 10, minWidth: 0,
    }}>
      <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.02em', flexShrink: 0 }}>DevCoach</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <RepoPicker
          current={currentRepo}
          history={repoHistory.filter(r => r !== currentRepo)}
          onSelect={onRepoChange}
        />
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
        <button onClick={() => setShowPuzzle(true)} title="Show puzzle"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vscode-descriptionForeground)', fontSize: 15, padding: '2px 4px' }}>
          🧩
        </button>
        <button onClick={onOpenConfig} title="Settings"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vscode-descriptionForeground)', fontSize: 16, padding: '2px 4px' }}>
          ⚙
        </button>
        <UserButton />
      </div>
    </div>
  )

  // ── Portrait layout ───────────────────────────────────────────────────────
  // Single vertical stack: Today · Queue · Chat · Velocity
  // Chat is fixed in the middle (priority in portrait), left panels are reorderable above/below.
  if (isNarrow) {
    // In portrait, show all panels stacked vertically.
    // Order: panelOrder panels first, then chat at position 2 (after Today+Queue, before Charts)
    // Actual order: today(or queue) → queue(or today) → chat → charts
    const [first, second, third] = panelOrder // e.g. ['today','queue','charts']
    const portraitOrder: Array<LeftPanelId | 'chat'> = [first, second, 'chat', third]
    const defaultSizes: Record<LeftPanelId | 'chat', number> = {
      today: 18, queue: 18, chat: 46, charts: 18,
    }

    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--vscode-editor-background)', overflow: 'hidden' }}>
        {puzzleOverlay}
        {header}
        {/* Re-key on order change to reset sizes */}
        <PanelGroup orientation="vertical" key={`portrait-${portraitOrder.join(',')}`} style={{ flex: 1, minHeight: 0 }}>
          {portraitOrder.map((id, idx) => (
            <React.Fragment key={id}>
              <Panel defaultSize={defaultSizes[id]} minSize={6}>
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <PanelBar
                    id={id}
                    label={id === 'chat' ? 'Chat' : PANEL_LABELS[id as LeftPanelId]}
                    subtitle={panelSubtitle(id)}
                    onDragStart={id !== 'chat' ? () => { dragSource.current = id as LeftPanelId } : undefined}
                    onDragOver={id !== 'chat' ? e => e.preventDefault() : undefined}
                    onDrop={id !== 'chat' ? () => handleDrop(id as LeftPanelId) : undefined}
                  />
                  <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                    {id === 'chat' ? chatPanel : renderLeft(id as LeftPanelId)}
                  </div>
                </div>
              </Panel>
              {idx < portraitOrder.length - 1 && (
                <PanelResizeHandle style={{ height: 5, background: 'var(--vscode-editorWidget-border)', cursor: 'row-resize' }} />
              )}
            </React.Fragment>
          ))}
        </PanelGroup>
      </div>
    )
  }

  // ── Wide layout ───────────────────────────────────────────────────────────
  // Horizontal: [Today / Queue / Velocity] | [Chat full-height]
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--vscode-editor-background)', overflow: 'hidden' }}>
      {puzzleOverlay}
      {header}
      <PanelGroup orientation="horizontal" style={{ flex: 1, minHeight: 0 }}>

        <Panel defaultSize={44} minSize={22}>
          <PanelGroup orientation="vertical" key={panelOrder.join(',')} style={{ height: '100%' }}>
            {panelOrder.map((id, idx) => (
              <React.Fragment key={id}>
                <Panel defaultSize={34} minSize={8}>
                  <div
                    style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => handleDrop(id)}
                  >
                    <PanelBar
                      id={id}
                      label={PANEL_LABELS[id]}
                      subtitle={panelSubtitle(id)}
                      onDragStart={() => { dragSource.current = id }}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => handleDrop(id)}
                    />
                    <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                      {renderLeft(id)}
                    </div>
                  </div>
                </Panel>
                {idx < panelOrder.length - 1 && (
                  <PanelResizeHandle style={{ height: 5, background: 'var(--vscode-editorWidget-border)', cursor: 'row-resize' }} />
                )}
              </React.Fragment>
            ))}
          </PanelGroup>
        </Panel>

        <PanelResizeHandle style={{ width: 5, background: 'var(--vscode-editorWidget-border)', cursor: 'col-resize' }} />

        <Panel defaultSize={56} minSize={28}>
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <PanelBar id="chat" label="Chat" subtitle={currentRepo} />
            {chatPanel}
          </div>
        </Panel>

      </PanelGroup>
    </div>
  )
}
