import { create } from 'zustand';

export type CallState = 'idle' | 'ringing' | 'connecting' | 'connected' | 'ended';

interface CallStore {
  callState: CallState;
  isIncoming: boolean;
  callerId: string | null;
  activeSessionId: string | null;
  isVideo: boolean;
  
  setCall: (state: CallState, isIncoming: boolean, callerId: string | null, sessionId: string | null, isVideo: boolean) => void;
  resetCall: () => void;
}

export const useCallStore = create<CallStore>((set) => ({
  callState: 'idle',
  isIncoming: false,
  callerId: null,
  activeSessionId: null,
  isVideo: false,

  setCall: (callState, isIncoming, callerId, activeSessionId, isVideo) => 
    set({ callState, isIncoming, callerId, activeSessionId, isVideo }),

  resetCall: () => 
    set({ callState: 'idle', isIncoming: false, callerId: null, activeSessionId: null, isVideo: false }),
}));
