export type Script = {
  id: string
  name: string
  command: string
  cwd: string
  createdAt: number
  isPinned: boolean
  /** The sessions whose chat gave or added it; absent on scripts from before 0.2. */
  sessions?: string[]
}

export type ListMode = 'project' | 'session'

declare module 'claude-code' {
  interface PluginState {
    'scripts-panel': {
      scripts: Script[]
      expanded: string[]
      notice: string
      viability: string
      editingId: string
      mode: ListMode
    }
  }
}
