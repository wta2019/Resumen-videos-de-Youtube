import React, { useState, useRef, useEffect } from 'react';
import { analyzeVideoUrl, createChatSession, generateSpeech } from './services/geminiService';
import { AnalysisResult, AppStatus, ChatMessage, AudioState } from './types';
import { IconYoutube, IconSend, IconRefresh, IconPDF, IconAudio, IconStop, IconSparkles } from './components/Icons';
import { Chat } from '@google/genai';

// Helper to decode raw PCM from Gemini
const decodePCM = (buffer: ArrayBuffer, ctx: AudioContext): AudioBuffer => {
  const pcmData = new Int16Array(buffer);
  const numChannels = 1;
  const sampleRate = 24000; // Gemini TTS standard output
  
  const audioBuffer = ctx.createBuffer(numChannels, pcmData.length, sampleRate);
  const channelData = audioBuffer.getChannelData(0);
  
  for (let i = 0; i < pcmData.length; i++) {
    // Normalize 16-bit integer to [-1.0, 1.0] float
    channelData[i] = pcmData[i] / 32768.0;
  }
  
  return audioBuffer;
};

const App: React.FC = () => {
  // State
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [audioState, setAudioState] = useState<AudioState>({ isPlaying: false, isLoading: false });
  const [activeTab, setActiveTab] = useState<'summary' | 'script'>('summary');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Refs
  const chatSessionRef = useRef<Chat | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Handlers
  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setStatus(AppStatus.ANALYZING);
    setErrorMsg(null);

    try {
      const result = await analyzeVideoUrl(url);
      setAnalysis(result);
      
      // Initialize Chat
      const chat = createChatSession(result);
      chatSessionRef.current = chat;
      
      // Add initial greeting
      setChatMessages([{
        id: 'init',
        role: 'model',
        text: `¡Hola! He analizado "${result.videoTitle || 'el video'}". Puedes preguntarme cualquier detalle sobre él.`,
        timestamp: Date.now()
      }]);

      setStatus(AppStatus.READY);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("No pude analizar el video. Asegúrate de que la URL es correcta y el video es público. (Nota: Funciona mejor con videos populares indexados por Google).");
      setStatus(AppStatus.ERROR);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentMessage.trim() || !chatSessionRef.current) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: currentMessage,
      timestamp: Date.now()
    };

    setChatMessages(prev => [...prev, userMsg]);
    setCurrentMessage('');
    setIsChatLoading(true);

    try {
      const response = await chatSessionRef.current.sendMessage({ message: userMsg.text });
      const text = response.text || "Lo siento, no pude generar una respuesta.";

      setChatMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: text,
        timestamp: Date.now()
      }]);
    } catch (err) {
      console.error(err);
      setChatMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: "Error al conectar con el asistente.",
        timestamp: Date.now()
      }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleReset = () => {
    stopAudio();
    setUrl('');
    setStatus(AppStatus.IDLE);
    setAnalysis(null);
    setChatMessages([]);
    chatSessionRef.current = null;
    setErrorMsg(null);
  };

  const handleExportPDF = () => {
    window.print();
  };

  const stopAudio = () => {
    if (audioSourceRef.current) {
      audioSourceRef.current.stop();
      audioSourceRef.current = null;
    }
    setAudioState({ isPlaying: false, isLoading: false });
  };

  const handlePlayAudio = async () => {
    if (audioState.isPlaying) {
      stopAudio();
      return;
    }

    if (!analysis?.summary) return;

    setAudioState({ isPlaying: false, isLoading: true });

    try {
      const rawAudioBuffer = await generateSpeech(analysis.summary);
      
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const ctx = audioContextRef.current;
      // Resume context if suspended (browser policy)
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      // Fix: Use manual PCM decoding instead of decodeAudioData
      const audioBuffer = decodePCM(rawAudioBuffer, ctx);
      
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      
      source.onended = () => {
        setAudioState(prev => ({ ...prev, isPlaying: false }));
      };

      source.start(0);
      audioSourceRef.current = source;
      setAudioState({ isPlaying: true, isLoading: false });

    } catch (err) {
      console.error("Audio playback error", err);
      setAudioState({ isPlaying: false, isLoading: false });
      alert("Error al generar o reproducir el audio.");
    }
  };

  // Render Helpers
  const renderContent = () => {
    if (status === AppStatus.ANALYZING) {
      return (
        <div className="flex flex-col items-center justify-center h-96 space-y-4 animate-pulse">
          <IconSparkles className="w-16 h-16 text-indigo-500 animate-spin-slow" />
          <p className="text-xl text-indigo-300 font-medium">Analizando video con IA...</p>
          <p className="text-sm text-slate-400">Extrayendo puntos clave y generando guion</p>
        </div>
      );
    }

    if (status === AppStatus.ERROR) {
      return (
        <div className="flex flex-col items-center justify-center h-96 space-y-4">
          <div className="p-4 bg-red-500/10 border border-red-500/50 rounded-lg max-w-md text-center">
            <p className="text-red-400">{errorMsg}</p>
          </div>
          <button 
            onClick={() => setStatus(AppStatus.IDLE)}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white transition"
          >
            Intentar de nuevo
          </button>
        </div>
      );
    }

    if (status === AppStatus.READY && analysis) {
      return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
          {/* Left Column: Summary & Script (Printable) */}
          <div className="flex flex-col space-y-4 h-full overflow-hidden" id="printable-content">
            <div className="bg-slate-800/50 rounded-2xl p-1 border border-slate-700 flex shrink-0 print:hidden">
              <button
                onClick={() => setActiveTab('summary')}
                className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
                  activeTab === 'summary' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
                }`}
              >
                Resumen
              </button>
              <button
                onClick={() => setActiveTab('script')}
                className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
                  activeTab === 'script' ? 'bg-pink-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
                }`}
              >
                Guion para Reel (60s)
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar bg-slate-800/30 rounded-2xl p-6 border border-slate-700/50">
              <h2 className="text-2xl font-bold text-white mb-2 print:text-black">{analysis.videoTitle}</h2>
              <div className="h-1 w-20 bg-gradient-to-r from-indigo-500 to-pink-500 rounded-full mb-6 print:hidden"></div>

              {activeTab === 'summary' && (
                <div className="prose prose-invert prose-p:text-slate-300 prose-headings:text-indigo-200 prose-strong:text-white prose-li:text-slate-300 max-w-none print:prose-headings:text-black print:prose-p:text-black print:prose-li:text-black">
                  {analysis.summary.split('\n').map((line, i) => (
                    <div key={i}>
                       {line.startsWith('#') ? (
                         <h3 className="text-xl font-semibold mt-4 mb-2 text-indigo-300 print:text-black">{line.replace(/^#+\s/, '')}</h3>
                       ) : line.startsWith('-') || line.startsWith('*') ? (
                         <li className="ml-4 mb-1">{line.replace(/^[-*]\s/, '')}</li>
                       ) : (
                         <p className="mb-2 leading-relaxed">{line}</p>
                       )}
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'script' && (
                <div className="space-y-4 font-mono text-sm">
                  <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700/50 print:bg-white print:border-gray-300">
                    <p className="text-pink-400 mb-2 font-bold uppercase tracking-wider print:text-black">Guion Generado</p>
                    <div className="whitespace-pre-wrap text-slate-300 print:text-black">
                      {analysis.reelScript}
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Action Bar (Hidden in Print) */}
            <div className="flex gap-3 print:hidden shrink-0">
               <button 
                onClick={handlePlayAudio}
                disabled={audioState.isLoading}
                className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl font-medium transition-all ${
                  audioState.isPlaying 
                    ? 'bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30' 
                    : 'bg-slate-800 text-indigo-300 border border-slate-700 hover:bg-slate-700 hover:border-indigo-500/50'
                }`}
              >
                {audioState.isLoading ? (
                  <span className="animate-spin h-5 w-5 border-2 border-indigo-400 border-t-transparent rounded-full"></span>
                ) : audioState.isPlaying ? (
                   <>
                    <IconStop className="w-5 h-5" /> Detener
                   </>
                ) : (
                  <>
                    <IconAudio className="w-5 h-5" /> Escuchar Resumen
                  </>
                )}
              </button>
              
              <button 
                onClick={handleExportPDF}
                className="flex-1 flex items-center justify-center gap-2 p-3 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white transition-all font-medium"
              >
                <IconPDF className="w-5 h-5" /> Exportar PDF
              </button>
            </div>
          </div>

          {/* Right Column: Chat (Hidden in Print) */}
          <div className="flex flex-col h-full bg-slate-800/30 rounded-2xl border border-slate-700/50 overflow-hidden print:hidden">
             <div className="p-4 bg-slate-800/50 border-b border-slate-700 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                <h3 className="font-semibold text-slate-200">Chat con el Video</h3>
             </div>

             <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {chatMessages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl p-3.5 text-sm leading-relaxed ${
                      msg.role === 'user' 
                        ? 'bg-indigo-600 text-white rounded-br-none' 
                        : 'bg-slate-700 text-slate-200 rounded-bl-none'
                    }`}>
                      {msg.text}
                    </div>
                  </div>
                ))}
                {isChatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-slate-700 rounded-2xl rounded-bl-none p-4 flex gap-1">
                      <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></span>
                      <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-100"></span>
                      <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-200"></span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
             </div>

             <form onSubmit={handleSendMessage} className="p-4 bg-slate-800/50 border-t border-slate-700 flex gap-2">
                <input
                  type="text"
                  value={currentMessage}
                  onChange={(e) => setCurrentMessage(e.target.value)}
                  placeholder="Pregunta algo sobre el video..."
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
                <button 
                  type="submit"
                  disabled={!currentMessage.trim() || isChatLoading}
                  className="p-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-white transition-colors"
                >
                  <IconSend className="w-5 h-5" />
                </button>
             </form>
          </div>
        </div>
      );
    }

    // Default: Input State
    return (
      <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto px-6 animate-fade-in">
        <div className="mb-8 p-6 rounded-full bg-slate-800/50 border border-slate-700 shadow-2xl shadow-indigo-500/10">
          <IconYoutube className="w-16 h-16 text-red-500" />
        </div>
        
        <h1 className="text-4xl md:text-5xl font-bold text-center mb-4 bg-clip-text text-transparent bg-gradient-to-r from-white via-indigo-200 to-indigo-400">
          VideoMind AI
        </h1>
        <p className="text-slate-400 text-center text-lg mb-8 max-w-lg">
          Transforma cualquier video de YouTube en resúmenes inteligentes, guiones virales y conversaciones interactivas.
        </p>

        <form onSubmit={handleAnalyze} className="w-full relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-pink-500 rounded-xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
          <div className="relative flex">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Pega la URL del video de YouTube aquí..."
              className="w-full bg-slate-900 border border-slate-700 text-white px-6 py-4 rounded-l-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50 placeholder-slate-600 text-lg transition-all"
            />
            <button
              type="submit"
              disabled={!url.trim()}
              className="bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white px-8 py-4 rounded-r-xl font-semibold text-lg transition-all shadow-lg flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              <IconSparkles className="w-5 h-5" />
              Analizar
            </button>
          </div>
        </form>

        <div className="mt-8 flex gap-4 text-sm text-slate-500">
           <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Resúmenes IA</span>
           <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span> Chatbot Memoria</span>
           <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-pink-500"></span> Guiones Reels</span>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0f172a] text-slate-100 font-sans selection:bg-indigo-500/30">
      {/* Navbar */}
      <nav className="h-16 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50 px-6 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3">
           <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
             <IconSparkles className="w-5 h-5 text-white" />
           </div>
           <span className="font-bold text-xl tracking-tight">VideoMind AI</span>
        </div>
        {status === AppStatus.READY && (
          <button 
            onClick={handleReset}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-slate-800"
          >
            <IconRefresh className="w-4 h-4" />
            Reiniciar
          </button>
        )}
      </nav>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full h-[calc(100vh-4rem)]">
        {renderContent()}
      </main>
    </div>
  );
};

export default App;