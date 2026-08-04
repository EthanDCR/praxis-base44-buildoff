import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react'
import { base44 } from './base44'
import { useUser } from './user-context'

interface DataStore {
  lists: any[]
  targets: any[]
  swaths: any[]
  loading: boolean
  allTargetsLoaded: boolean
  updateTarget: (id: string, patch: Record<string, any>) => Promise<void>
  refresh: () => Promise<void>
}

const DataStoreContext = createContext<DataStore | null>(null)

export function DataStoreProvider({ children }: { children: ReactNode }) {
  const user = useUser()
  const [lists, setLists] = useState<any[]>([])
  const [targets, setTargets] = useState<any[]>([])
  const [swaths, setSwaths] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [allTargetsLoaded, setAllTargetsLoaded] = useState(false)
  const loadIdRef = useRef(0)

  async function load() {
    const loadId = ++loadIdRef.current
    setLoading(true)
    setAllTargetsLoaded(false)

    try {
      const isRep = !!user?.email && user.role !== 'admin'

      const [l, s] = await Promise.all([
        base44.entities.CallList.list(),
        base44.entities.HailSwath.filter({}, undefined, 500),
      ])
      if (loadId !== loadIdRef.current) return
      setLists(l as any[])
      setSwaths(s as any[])

      if (isRep) {
        // Reps go through fallback login (unverified Base44 accounts) so there's
        // no auth token — server-side filter is ignored on unauthenticated requests.
        // Load all targets in pages and filter entirely client-side.
        const PAGE = 500
        let skip = 0
        const all: any[] = []
        const repEmail = user!.email!.toLowerCase()
        while (true) {
          const page = await base44.entities.Target.filter({}, undefined, PAGE, skip) as any[]
          if (loadId !== loadIdRef.current) return
          all.push(...page.filter((x: any) => x.assigned_to?.toLowerCase() === repEmail))
          setTargets([...all])
          if (skip === 0) setLoading(false)
          if (page.length < PAGE) break
          skip += PAGE
        }
        setAllTargetsLoaded(true)
      } else {
        // Admins: stream all targets in pages, unlock UI after first page
        const PAGE = 500
        let skip = 0
        const all: any[] = []
        while (true) {
          const page = await base44.entities.Target.filter({}, undefined, PAGE, skip) as any[]
          if (loadId !== loadIdRef.current) return
          all.push(...page)
          setTargets([...all])
          if (skip === 0) setLoading(false)
          if (page.length < PAGE) break
          skip += PAGE
        }
        setAllTargetsLoaded(true)
      }
    } catch (err) {
      console.error('DataStore fetch error:', err)
      setLoading(false)
    }
  }

  // Re-run when user's email or role changes (role resolves async after mount)
  useEffect(() => { load() }, [user?.email, user?.role])

  async function updateTarget(id: string, patch: Record<string, any>) {
    await base44.entities.Target.update(id, patch)
    setTargets(prev => prev.map((t: any) => t.id === id ? { ...t, ...patch } : t))
  }

  return (
    <DataStoreContext.Provider value={{ lists, targets, swaths, loading, allTargetsLoaded, updateTarget, refresh: load }}>
      {children}
    </DataStoreContext.Provider>
  )
}

export function useDataStore() {
  const ctx = useContext(DataStoreContext)
  if (!ctx) throw new Error('useDataStore must be used inside DataStoreProvider')
  return ctx
}
