import { useEffect, useRef, useState } from 'react';

export interface VoiceLessonEvent {
  type: 'transcript' | 'assistant_text' | 'sources' | 'turn_complete';
  role?: 'user';
  content?: string;
  message_id?: string;
  sources?: Array<{
    document_id: string;
    filename: string;
    chunk_index: number;
    snippet: string;
    score: number;
  }>;
}

interface VoiceLessonOptions {
  sessionId: string;
  onEvent: (event: VoiceLessonEvent) => void;
  onActiveChange: (active: boolean) => void;
}

export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'error';

/** Live audio levels (0..1) read by the orb animation every frame without re-rendering React. */
export interface VoiceLevels { mic: number; tutor: number }

export function useVoiceLesson({ sessionId, onEvent, onActiveChange }: VoiceLessonOptions) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [error, setError] = useState('');
  const levelsRef = useRef<VoiceLevels>({ mic: 0, tutor: 0 });
  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  // Playback runs on its own 24 kHz context so tutor audio is never resampled chunk-by-chunk
  // (that caused clicks/buzzing at chunk boundaries). The mic keeps the device's native rate.
  const playbackContextRef = useRef<AudioContext | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const playbackTimeRef = useRef(0);
  const readyResolverRef = useRef<((ready: boolean) => void) | null>(null);
  const onEventRef = useRef(onEvent);
  const onActiveChangeRef = useRef(onActiveChange);

  useEffect(() => {
    onEventRef.current = onEvent;
    onActiveChangeRef.current = onActiveChange;
  }, [onEvent, onActiveChange]);

  const stop = () => {
    readyResolverRef.current?.(false);
    readyResolverRef.current = null;

    const socket = socketRef.current;
    socketRef.current = null;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'stop' }));
    }
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();

    processorRef.current?.disconnect();
    processorRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;

    audioSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Sources that have already finished cannot be stopped again.
      }
    });
    audioSourcesRef.current.clear();

    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== 'closed') void audioContext.close();
    const playbackContext = playbackContextRef.current;
    playbackContextRef.current = null;
    outputGainRef.current = null;
    if (playbackContext && playbackContext.state !== 'closed') void playbackContext.close();

    playbackTimeRef.current = 0;
    levelsRef.current = { mic: 0, tutor: 0 };
    setStatus((current) => current === 'error' ? 'error' : 'idle');
    onActiveChangeRef.current(false);
  };

  useEffect(() => () => {
    readyResolverRef.current?.(false);
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' }));
    socket?.close();
    processorRef.current?.disconnect();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioSourcesRef.current.forEach((source) => {
      try { source.stop(); } catch { /* Already stopped. */ }
    });
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      void audioContextRef.current.close();
    }
    if (playbackContextRef.current && playbackContextRef.current.state !== 'closed') {
      void playbackContextRef.current.close();
    }
  }, []);

  const playAudio = (audioContext: AudioContext, encoded: string) => {
    const binary = atob(encoded);
    const samples = new Int16Array(binary.length / 2);
    for (let i = 0; i < samples.length; i += 1) {
      const low = binary.charCodeAt(i * 2);
      const high = binary.charCodeAt(i * 2 + 1);
      let value = (high << 8) | low;
      if (value >= 0x8000) value -= 0x10000;
      samples[i] = value;
    }

    if (!samples.length) return;
    const buffer = audioContext.createBuffer(1, samples.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) channel[i] = samples[i] / 32768;

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(outputGainRef.current ?? audioContext.destination);
    audioSourcesRef.current.add(source);
    source.onended = () => audioSourcesRef.current.delete(source);
    // Keep a small cushion ahead of the playhead. If the queue ran dry (or this is the first chunk),
    // rebuild ~150 ms of buffer so network/main-thread jitter doesn't leave audible gaps.
    const now = audioContext.currentTime;
    const startAt = playbackTimeRef.current > now ? playbackTimeRef.current : now + 0.15;
    source.start(startAt);
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i += 1) sumSquares += (samples[i] / 32768) ** 2;
    const chunkLevel = Math.min(1, Math.sqrt(sumSquares / samples.length) * 6);
    window.setTimeout(() => { levelsRef.current.tutor = chunkLevel; }, Math.max(0, (startAt - audioContext.currentTime) * 1000));
    playbackTimeRef.current = startAt + buffer.duration;
  };

  const start = async () => {
    if (!sessionId || status === 'connecting' || status === 'listening') return;
    setError('');
    setStatus('connecting');
    onActiveChangeRef.current(true);

    let audioContext: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let socket: WebSocket | null = null;

    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
        throw new Error('Your browser does not support microphone voice lessons. Please use text chat instead.');
      }

      // Create/resume audio synchronously from the user's button gesture for mobile autoplay policies.
      audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      await audioContext.resume();

      const playbackContext = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
      const outputGain = playbackContext.createGain();
      outputGain.connect(playbackContext.destination);
      playbackContextRef.current = playbackContext;
      outputGainRef.current = outputGain;
      await playbackContext.resume();

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(
        `${protocol}//${window.location.host}/api/chat/voice/${encodeURIComponent(sessionId)}`
      );
      socketRef.current = socket;

      const ready = new Promise<boolean>((resolve) => {
        readyResolverRef.current = resolve;
        const timeout = window.setTimeout(() => {
          readyResolverRef.current = null;
          resolve(false);
        }, 20000);
        socket?.addEventListener('message', (event) => {
          let packet: Record<string, unknown>;
          try {
            packet = JSON.parse(String(event.data)) as Record<string, unknown>;
          } catch {
            return;
          }

          if (packet.type === 'ready') {
            window.clearTimeout(timeout);
            readyResolverRef.current?.(true);
            readyResolverRef.current = null;
          } else if (packet.type === 'error') {
            const message = typeof packet.message === 'string' ? packet.message : 'Voice connection failed.';
            setError(message);
            setStatus('error');
            window.clearTimeout(timeout);
            readyResolverRef.current?.(false);
            readyResolverRef.current = null;
            socket?.close();
          } else if (packet.type === 'audio' && typeof packet.data === 'string') {
            try { playAudio(playbackContextRef.current!, packet.data); } catch (audioError) {
              console.error('Could not play tutor audio:', audioError);
            }
          } else if (packet.type === 'interrupted') {
            const playback = playbackContextRef.current;
            const gain = outputGainRef.current;
            const sources = Array.from(audioSourcesRef.current);
            audioSourcesRef.current.clear();
            levelsRef.current.tutor = 0;
            if (playback && gain) {
              // Quick fade-out so the cut doesn't pop, then restore the gain for the next turn.
              gain.gain.cancelScheduledValues(playback.currentTime);
              gain.gain.setTargetAtTime(0, playback.currentTime, 0.01);
              window.setTimeout(() => {
                sources.forEach((source) => { try { source.stop(); } catch { /* already finished */ } });
                if (playbackContextRef.current === playback) gain.gain.setValueAtTime(1, playback.currentTime);
              }, 60);
              playbackTimeRef.current = 0;
            }
          } else if (packet.type === 'transcript' || packet.type === 'assistant_text' ||
                     packet.type === 'sources' || packet.type === 'turn_complete') {
            onEventRef.current(packet as unknown as VoiceLessonEvent);
          }
        });
        socket?.addEventListener('error', () => {
          window.clearTimeout(timeout);
          resolve(false);
        }, { once: true });
        socket?.addEventListener('close', () => {
          window.clearTimeout(timeout);
          readyResolverRef.current?.(false);
          readyResolverRef.current = null;
          if (socketRef.current === socket) stop();
        }, { once: true });
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Could not connect to the voice service.')), 20000);
        socket!.addEventListener('open', () => {
          window.clearTimeout(timeout);
          resolve();
        }, { once: true });
        socket!.addEventListener('error', () => {
          window.clearTimeout(timeout);
          reject(new Error('Could not connect to the voice service.'));
        }, { once: true });
      });

      if (!await ready) throw new Error('The voice service did not become ready. Check the Gemini setup or continue in text chat.');

      const microphone = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const mutedOutput = audioContext.createGain();
      mutedOutput.gain.value = 0;
      processor.onaudioprocess = (event) => {
        if (socket!.readyState !== WebSocket.OPEN) return;
        const input = event.inputBuffer.getChannelData(0);
        let sumSquares = 0;
        for (let i = 0; i < input.length; i += 1) sumSquares += input[i] * input[i];
        levelsRef.current.mic = Math.min(1, Math.sqrt(sumSquares / input.length) * 7);
        const ratio = audioContext!.sampleRate / 16000;
        const outputLength = Math.floor(input.length / ratio);
        const pcm = new ArrayBuffer(outputLength * 2);
        const view = new DataView(pcm);
        for (let i = 0; i < outputLength; i += 1) {
          const sourceIndex = Math.min(Math.floor(i * ratio), input.length - 1);
          const sample = Math.max(-1, Math.min(1, input[sourceIndex]));
          view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        }
        const bytes = new Uint8Array(pcm);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
        socket!.send(JSON.stringify({ type: 'audio', data: btoa(binary) }));
      };
      microphone.connect(processor);
      processor.connect(mutedOutput);
      mutedOutput.connect(audioContext.destination);
      processorRef.current = processor;

      setStatus('listening');
      onActiveChangeRef.current(true);
    } catch (startError) {
      const message = startError instanceof Error ? startError.message : 'Unable to start the voice lesson.';
      setError(message);
      setStatus('error');
      readyResolverRef.current?.(false);
      readyResolverRef.current = null;
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
      if (stream) stream.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      if (audioContext && audioContext.state !== 'closed') void audioContext.close();
      audioContextRef.current = null;
      if (playbackContextRef.current && playbackContextRef.current.state !== 'closed') void playbackContextRef.current.close();
      playbackContextRef.current = null;
      outputGainRef.current = null;
      socketRef.current = null;
      onActiveChangeRef.current(false);
    }
  };

  const sendText = (content: string): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type: 'text', content }));
    return true;
  };

  return { status, error, start, stop, sendText, levelsRef };
}
