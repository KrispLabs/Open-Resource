import { create } from 'zustand'
import type { Application } from '@open-resource/shared'

interface RankingsState {
  candidates: Application[]
  setCandidates: (candidates: Application[]) => void
  updateCandidate: (id: string, patch: Partial<Application>) => void
  clearCandidates: () => void
}

export const useRankingsStore = create<RankingsState>((set) => ({
  candidates: [],
  setCandidates: (candidates) => set({ candidates }),
  updateCandidate: (id, patch) =>
    set((state) => ({
      candidates: state.candidates.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })),
  clearCandidates: () => set({ candidates: [] }),
}))
