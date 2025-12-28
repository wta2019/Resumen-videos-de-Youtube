import { GoogleGenAI, Type, Modality } from "@google/genai";
import { AnalysisResult } from "../types";

// Helper to get API Key safely
const getApiKey = (): string => {
  const key = process.env.API_KEY;
  if (!key) {
    console.error("API_KEY not found in environment variables");
    return "";
  }
  return key;
};

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: getApiKey() });

/**
 * Analyzes a YouTube video URL using Google Search Grounding to find context.
 * Returns a structured summary and a reel script.
 */
export const analyzeVideoUrl = async (url: string): Promise<AnalysisResult> => {
  try {
    const prompt = `
      Actúa como un asistente experto en creación de contenido y análisis de video.
      
      Tu tarea es investigar el siguiente video de YouTube: "${url}"
      
      Utiliza la herramienta de Google Search para encontrar información sobre este video, incluyendo su título, transcripción (si está disponible en búsquedas), descripción y opiniones.
      
      Basado en la información encontrada, genera un objeto JSON con la siguiente estructura:
      1. "videoTitle": El título del video.
      2. "summary": Un resumen detallado y estructurado de los aspectos más importantes del video. Usa formato Markdown para listas y negritas. Asegúrate de que sea fácil de leer.
      3. "reelScript": Un guion técnico para un Reel/Short de 60 segundos (aprox 140-160 palabras) que resalte los puntos clave para volverse viral. Incluye indicaciones visuales entre paréntesis.

      Responde ÚNICAMENTE con el JSON.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview', // Using Pro for better reasoning and search capabilities
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            videoTitle: { type: Type.STRING },
            summary: { type: Type.STRING },
            reelScript: { type: Type.STRING },
          },
          required: ["summary", "reelScript"],
        },
      },
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");

    return JSON.parse(text) as AnalysisResult;
  } catch (error) {
    console.error("Error analyzing video:", error);
    throw error;
  }
};

/**
 * Generates audio from text using Gemini TTS.
 */
export const generateSpeech = async (text: string): Promise<ArrayBuffer> => {
  try {
    // Clean markdown for better speech
    const cleanText = text.replace(/[*#_\[\]]/g, ''); 
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: cleanText }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' }, // 'Kore' is usually good for clarity
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    
    if (!base64Audio) {
      throw new Error("No audio data generated");
    }

    // Convert Base64 to ArrayBuffer
    const binaryString = atob(base64Audio);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;

  } catch (error) {
    console.error("Error generating speech:", error);
    throw error;
  }
};

/**
 * Creates a chat session initialized with the video context.
 */
export const createChatSession = (context: AnalysisResult) => {
  const systemInstruction = `
    Eres un asistente experto llamado "VideoMind".
    El usuario te hará preguntas sobre un video de YouTube que acabas de analizar.
    
    Aquí está la información del video:
    Título: ${context.videoTitle || 'Desconocido'}
    Resumen: ${context.summary}
    Guion de Reel: ${context.reelScript}
    
    Responde a las preguntas del usuario basándote en esta información. 
    Sé amable, conciso y útil. Responde siempre en Español.
  `;

  return ai.chats.create({
    model: 'gemini-3-pro-preview',
    config: {
      systemInstruction: systemInstruction,
    },
  });
};