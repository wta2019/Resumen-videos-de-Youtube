export interface AnalysisResult {
  summary: string;
  reelScript: string;
  videoTitle?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export enum AppStatus {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING',
  READY = 'READY',
  ERROR = 'ERROR',
}

export interface AudioState {
  isPlaying: boolean;
  isLoading: boolean;
}