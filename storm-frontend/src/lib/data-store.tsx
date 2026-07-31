import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { base44 } from './base44'

interface DataStore {
  lists: any[]
  targets: any[]
  swaths: any[]
  loading: boolean
  updateTarget: (id: string, patch: Record<string, any>) => Promise<void>
  refresh: () => Promise<void>
}

const DataStoreContext = createContext<DataStore | null>(null)

export function DataStoreProvider({ children }: { children: ReactNode }) {
  const [lists, setLists] = useState<any[]>([])
  const [targets, setTargets] = useState<any[]>([])
  const [swaths, setSwaths] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const [l, t, s] = await Promise.all([
        base44.entities.CallList.list(),
        base44.entities.Target.filter({}, undefined, 2000),
        base44.entities.HailSwath.filter({}, undefined, 500),
      ])
      setLists(l as any[])
      setTargets(t as any[])
      setSwaths(s as any[])
    } catch (err) {
      console.error('DataStore fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function updateTarget(id: string, patch: Record<string, any>) {
    await base44.entities.Target.update(id, patch)
    setTargets(prev => prev.map((t: any) => t.id === id ? { ...t, ...patch } : t))
  }

  return (
    <DataStoreContext.Provider value={{ lists, targets, swaths, loading, updateTarget, refresh: load }}>
      {children}
    </DataStoreContext.Provider>
  )
}

export function useDataStore() {
  const ctx = useContext(DataStoreContext)
  if (!ctx) throw new Error('useDataStore must be used inside DataStoreProvider')
  return ctx
}
