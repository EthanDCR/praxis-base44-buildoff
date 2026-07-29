import { createContext, useContext } from 'react'

export interface AppUser {
  id: string
  email: string
  full_name: string | null
  role: string
}

const UserContext = createContext<AppUser | null>(null)
export const UserProvider = UserContext.Provider
export function useUser() { return useContext(UserContext) }
