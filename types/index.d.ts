export type ActiveRole = { id: string; name: string; category: string }

declare module 'claude-code' {
  interface PluginState {
    roles: {
      active: Shaped<ActiveRole | null>
      query: string
      // The role id last sent to the model in full; null when none was.
      announced: string | null
      // Whether this conversation was told how to delegate with --role.
      hinted: boolean
      // The first picker row drawn.
      windowAt: number
      // The picker slot holding the focus ring; -1 for none.
      focusedSlot: number
    }
  }
}
