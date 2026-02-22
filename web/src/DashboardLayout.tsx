import React, { useRef, useState } from 'react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import type {
  ApiClient, ChatContext, ProactiveTrigger, QueueItem, Session, WorkBlock,
} from '@ext/services/ApiClient'
import TodayPanel from '@ext/webview/components/TodayPanel'
import QueuePanel from '@ext/webview/components/QueuePanel'
import ChatPanel from '@ext/webview/components/ChatPanel'
import ChartsPanel from '@ext/webview/components/ChartsPanel'
import PuzzlePanel from '@ext/webview/components/PuzzlePanel'

type LeftPanelId = 'today' | 'queue' | 'charts'

const PANEL_LABELS: Record<LeftPanelId, string> = {
  today: 'Today',
  queue: 'Queue',
  charts: 'Charts',
}

interface Props {
  apiClient: ApiClient | null
  session: Session | null
  currentBlock: WorkBlock | null
  repo: string
  pendingProactiveMessage: { trigger: ProactiveTrigger; context: ChatContext } | null
  onSessionChange: (s: Session | null) => void
  onBlockChange: (b: WorkBlock | null) => void
  onProactiveTrigger: (trigger: ProactiveTrigger, context?: Record<string, unknown>) => void
  onProactiveConsumed: () => void
  onOpenConfig: () => void
}

export default function DashboardLayout({
  apiClient, session, currentBlock, repo,
  pendingProactiveMessage, onSessionChange, onBlockChange,
  onProactiveTrigger, onProactiveConsumed, onOpenConfig,
}: Props) {
  const [panelOrder, setPanelOrder] = useState<LeftPanelId[]>(['today', 'queue', 'charts'])
  const [showPuzzle, setShowPuzzle] = useState(true)
  const dragSource = useRef<LeftPanelId | null>(null)
  const dragOver = useRef<LeftPanelId | null>(null)

  const handleDrop = (targetId: LeftPanelId) => {
    const src = dragSource.current
    if (!src || src === targetId) return
    setPanelOrder(prev => {
      const next = [...prev]
      const si = next.indexOf(src)
      const ti = next.indexOf(targetId)
      next.splice(si, 1)
      next.splice(ti, 0, src)
      return next
    })
    dragSource.current = null
    dragOver.current = null
  }

  const renderContent = (id: LeftPanelId) => {
    switch (id) {
      case 'today':
        return (
          <TodayPanel
            apiClient={apiClient}
            session={session}
            currentBlock={currentBlock}
            repo={repo}
            onSessionChange={onSessionChange}
            onBlockChange={onBlockChange}
            onProactiveTrigger={onProactiveTrigger}
          />
        )
      case 'queue':
        return (
          <QueuePanel
            apiClient={apiClient}
            session={session}
            repo={repo}
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

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--vscode-editor-background)', overflow: 'hidden' }}>

      {/* Puzzle overlay — shown at day start */}
      {showPuzzle && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(2px)',
        }}>
          <div style={{
            background: 'var(--vscode-editorWidget-background)',
            border: '1px solid var(--vscode-editorWidget-border)',
            borderRadius: 10,
            width: 'min(680px, 92vw)',
            maxHeight: '88vh',
            overflow: 'auto',
            position: 'relative',
            boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          }}>
            {/* Modal header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px 0',
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5 }}>
                Morning Warm-Up
              </span>
              <button
                onClick={() => setShowPuzzle(false)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--vscode-descriptionForeground)',
                  fontSize: 18, lineHeight: 1, padding: '2px 4px',
                }}
                title="Skip puzzle, start work"
              >
                ✕
              </button>
            </div>

            <PuzzlePanel apiClient={apiClient} />

            {/* Start Work shortcut */}
            <div style={{ padding: '0 16px 16px', textAlign: 'center' }}>
              <button
                className="dc-btn dc-btn-ghost"
                onClick={() => setShowPuzzle(false)}
                style={{ fontSize: 12 }}
              >
                Skip — Start Work
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '5px 14px',
        background: 'var(--vscode-editorGroupHeader-tabsBackground)',
        borderBottom: '1px solid var(--vscode-editorWidget-border)',
        flexShrink: 0,
        zIndex: 10,
      }}>
        <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.02em' }}>DevCoach</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => setShowPuzzle(true)}
            title="Show puzzle"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vscode-descriptionForeground)', fontSize: 15, padding: '2px 4px' }}
          >
            🧩
          </button>
          <button
            onClick={onOpenConfig}
            title="Settings"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--vscode-descriptionForeground)', fontSize: 16, padding: '2px 4px' }}
          >
            ⚙
          </button>
        </div>
      </div>

      {/* Main layout */}
      <PanelGroup orientation="horizontal" style={{ flex: 1, minHeight: 0 }}>

        {/* Left column: resizable + reorderable panels */}
        <Panel defaultSize={44} minSize={22}>
          {/* Re-key forces remount (size reset) when order changes — intentional */}
          <PanelGroup orientation="vertical" key={panelOrder.join(',')} style={{ height: '100%' }}>
            {panelOrder.map((id, idx) => (
              <React.Fragment key={id}>
                <Panel defaultSize={34} minSize={8}>
                  {/* Draggable panel wrapper */}
                  <div
                    style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                    onDragOver={e => { e.preventDefault(); dragOver.current = id }}
                    onDrop={() => handleDrop(id)}
                  >
                    {/* Panel title bar with drag handle */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '3px 10px',
                      background: 'var(--vscode-editorGroupHeader-tabsBackground)',
                      borderBottom: '1px solid var(--vscode-editorWidget-border)',
                      flexShrink: 0,
                      userSelect: 'none',
                    }}>
                      <span
                        draggable
                        onDragStart={e => { e.stopPropagation(); dragSource.current = id }}
                        style={{ cursor: 'grab', opacity: 0.45, fontSize: 15, lineHeight: 1, marginRight: 2 }}
                        title="Drag to reorder"
                      >
                        ⠿
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', opacity: 0.65 }}>
                        {PANEL_LABELS[id]}
                      </span>
                    </div>

                    {/* Panel content */}
                    <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                      {renderContent(id)}
                    </div>
                  </div>
                </Panel>

                {idx < panelOrder.length - 1 && (
                  <PanelResizeHandle style={{
                    height: 5,
                    background: 'var(--vscode-editorWidget-border)',
                    cursor: 'row-resize',
                    flexShrink: 0,
                  }} />
                )}
              </React.Fragment>
            ))}
          </PanelGroup>
        </Panel>

        {/* Vertical divider */}
        <PanelResizeHandle style={{
          width: 5,
          background: 'var(--vscode-editorWidget-border)',
          cursor: 'col-resize',
        }} />

        {/* Right column: Chat, full height */}
        <Panel defaultSize={56} minSize={28}>
          <div style={{ height: '100%', overflow: 'hidden' }}>
            <ChatPanel
              apiClient={apiClient}
              session={session}
              currentBlock={currentBlock}
              pendingProactiveMessage={pendingProactiveMessage}
              onProactiveConsumed={onProactiveConsumed}
            />
          </div>
        </Panel>

      </PanelGroup>
    </div>
  )
}
