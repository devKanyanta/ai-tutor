import { useEffect, useRef, useState } from 'react';
import type { LessonState } from '../../types';

export interface VoiceLessonEvent {
  type: 'transcript' | 'assistant_text' | 'sources' | 'turn_complete' | 'status' | 'lesson';
  message?: string;
  lesson?: LessonState;
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

/** Playback speed multipliers. Slowing playback is the reliable way to pace the tutor; prompts alone are not. */
export const PACE_RATES = { normal: 1, relaxed: 0.88, slow: 0.76 } as const;
export type Pace = keyof typeof PACE_RATES;

export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'error';

interface TurnAudio {
  scheduled: number;   // seconds of tutor audio received this turn
  playedBase: number;  // seconds already played in earlier uninterrupted runs
  runStart: number;    // playback-context time the current run began
  runEnd: number;      // playback-context time the current run ends
  ended: boolean;      // the turn finished; the next text/audio starts a new one
  frozen: number | null; // fraction to hold after an interruption
  textSince: number;   // wall-clock ms when this turn's text started (fallback if no audio arrives)
}
const newTurnAudio = (): TurnAudio => ({ scheduled: 0, playedBase: 0, runStart: 0, runEnd: 0, ended: false, frozen: null, textSince: Date.now() });

/** Live audio levels (0..1) read by the orb animation every frame without re-rendering React. */
export interface VoiceLevels { mic: number; tutor: number }

export function useVoiceLesson({ sessionId, onEvent, onActiveChange }: VoiceLessonOptions) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [error, setError] = useState('');
  const levelsRef = useRef<VoiceLevels>({ mic: 0, tutor: 0 });
  const paceRef = useRef<number>(PACE_RATES.normal);
  // Echo guard: while the tutor is audible the mic is muted toward the server unless the student is
  // clearly louder than the tutor's own output (barge-in). Stops the tutor hearing itself.
  const gateRef = useRef({ lastTutorAt: 0, loudFrames: 0, barge: false, pending: [] as string[] });
  const discardAudioRef = useRef(false);
  // Playback cushion (seconds). Grows after an underrun so a flaky connection stops causing skips.
  const leadRef = useRef(0.25);
  // Stateful slow-down resampler: keeps its position/last sample between chunks so there are no seams.
  const resamplerRef = useRef({ pos: 0, prev: 0 });
  // Per-turn audio clock, used to reveal the tutor's text in step with what is actually being heard.
  const turnAudioRef = useRef<TurnAudio>(newTurnAudio());
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
    resamplerRef.current = { pos: 0, prev: 0 };
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
    const input = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) input[i] = samples[i] / 32768;

    // Slow the voice by linear-interpolating at `rate` source samples per output sample. Doing this
    // here (continuously across chunks) avoids the clicks the browser's per-buffer resampling causes.
    const rate = paceRef.current;
    let output: Float32Array = input;
    if (rate !== 1) {
      const state = resamplerRef.current;
      const out: number[] = [];
      let t = state.pos;
      while (Math.floor(t) + 1 <= input.length - 1) {
        const i = Math.floor(t);
        const frac = t - i;
        const a = i < 0 ? state.prev : input[i];
        out.push(a + (input[i + 1] - a) * frac);
        t += rate;
      }
      state.pos = t - input.length;
      state.prev = input[input.length - 1];
      output = Float32Array.from(out);
    } else {
      resamplerRef.current = { pos: 0, prev: input[input.length - 1] };
    }
    if (!output.length) return;

    const buffer = audioContext.createBuffer(1, output.length, 24000);
    buffer.copyToChannel(output as Float32Array<ArrayBuffer>, 0);
    const playDuration = buffer.duration;

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(outputGainRef.current ?? audioContext.destination);
    audioSourcesRef.current.add(source);
    source.onended = () => audioSourcesRef.current.delete(source);
    // Keep a small cushion ahead of the playhead. If the queue ran dry (or this is the first chunk),
    // rebuild ~150 ms of buffer so network/main-thread jitter doesn't leave audible gaps.
    const now = audioContext.currentTime;
    const queueDry = !(playbackTimeRef.current > now);
    if (turnAudioRef.current.scheduled > 0 && !turnAudioRef.current.ended && queueDry && playbackTimeRef.current > 0) {
      leadRef.current = Math.min(0.7, leadRef.current + 0.1); // real underrun mid-turn: buffer more next time
    }
    const startAt = queueDry ? now + leadRef.current : playbackTimeRef.current;
    source.start(startAt);

    let turn = turnAudioRef.current;
    if (turn.ended) { turn = newTurnAudio(); turnAudioRef.current = turn; }
    turn.frozen = null;
    if (queueDry) {
      if (turn.runEnd > turn.runStart) turn.playedBase += turn.runEnd - turn.runStart;
      turn.runStart = startAt;
    }
    turn.runEnd = startAt + playDuration;
    turn.scheduled += playDuration;
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i += 1) sumSquares += (samples[i] / 32768) ** 2;
    const chunkLevel = Math.min(1, Math.sqrt(sumSquares / samples.length) * 6);
    window.setTimeout(() => { levelsRef.current.tutor = chunkLevel; }, Math.max(0, (startAt - audioContext.currentTime) * 1000));
    playbackTimeRef.current = startAt + playDuration;
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

      const playbackContext = new AudioContext({ sampleRate: 24000, latencyHint: 'playback' });
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
          autoGainControl: false, // AGC boosts faint speaker echo into something the server mistakes for speech
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
            if (discardAudioRef.current) return; // student cut the tutor off; drop the rest of that turn
            try { playAudio(playbackContextRef.current!, packet.data); } catch (audioError) {
              console.error('Could not play tutor audio:', audioError);
            }
          } else if (packet.type === 'interrupted') {
            discardAudioRef.current = false;
            turnAudioRef.current.frozen = getSpeechProgress();
            turnAudioRef.current.ended = true;
            cutPlayback();
          } else if (packet.type === 'transcript' || packet.type === 'assistant_text' ||
                     packet.type === 'sources' || packet.type === 'turn_complete' ||
                     packet.type === 'status' || packet.type === 'lesson') {
            if (packet.type === 'assistant_text' && turnAudioRef.current.ended) turnAudioRef.current = newTurnAudio();
            if (packet.type === 'turn_complete') { turnAudioRef.current.ended = true; discardAudioRef.current = false; }
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
        const micLevel = Math.min(1, Math.sqrt(sumSquares / input.length) * 7);

        // Echo guard (see gateRef): only let the mic through while the tutor is audible if the student
        // is clearly louder than the tutor's own output for a few frames in a row.
        const gate = gateRef.current;
        const playback = playbackContextRef.current;
        const nowMs = performance.now();
        const tutorPlaying = !!playback && playbackTimeRef.current > playback.currentTime;
        if (tutorPlaying) gate.lastTutorAt = nowMs;
        const echoWindow = tutorPlaying || nowMs - gate.lastTutorAt < 450;
        let open = true;
        if (echoWindow && !gate.barge) {
          const louder = micLevel > Math.max(0.22, levelsRef.current.tutor * 1.4);
          gate.loudFrames = louder ? gate.loudFrames + 1 : 0;
          if (gate.loudFrames >= 3) gate.barge = true; else open = false;
        } else if (!echoWindow) {
          gate.barge = false;
          gate.loudFrames = 0;
        }
        levelsRef.current.mic = open ? micLevel : 0;

        // Downsample to 16 kHz by averaging (a simple low-pass; picking single samples aliases and hurts recognition).
        const ratio = audioContext!.sampleRate / 16000;
        const outputLength = Math.floor(input.length / ratio);
        const pcm = new ArrayBuffer(outputLength * 2);
        const view = new DataView(pcm);
        for (let i = 0; i < outputLength; i += 1) {
          const from = Math.floor(i * ratio);
          const to = Math.max(from + 1, Math.min(input.length, Math.floor((i + 1) * ratio)));
          let sum = 0;
          for (let j = from; j < to; j += 1) sum += input[j];
          const sample = Math.max(-1, Math.min(1, sum / (to - from)));
          view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        }
        const encode = (bytes: Uint8Array) => {
          let binary = '';
          for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
          return btoa(binary);
        };
        const frame = encode(new Uint8Array(pcm));
        if (!open) {
          // Keep the last few frames so the start of a barge-in isn't clipped; send silence meanwhile.
          gate.pending.push(frame);
          if (gate.pending.length > 3) gate.pending.shift();
          socket!.send(JSON.stringify({ type: 'audio', data: encode(new Uint8Array(outputLength * 2)) }));
          return;
        }
        for (const queued of gate.pending) socket!.send(JSON.stringify({ type: 'audio', data: queued }));
        gate.pending = [];
        socket!.send(JSON.stringify({ type: 'audio', data: frame }));
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

  /**
   * 0..1: how much of the current tutor turn has been heard. Text is revealed by this fraction so it
   * stays in step with the voice instead of racing ahead (transcripts arrive well before playback).
   */
  function getSpeechProgress(): number {
    const turn = turnAudioRef.current;
    if (turn.frozen !== null) return turn.frozen;
    const context = playbackContextRef.current;
    if (!context) return 1;
    if (turn.scheduled <= 0) return Date.now() - turn.textSince > 2500 ? 1 : 0;
    const run = Math.min(Math.max(context.currentTime - turn.runStart, 0), turn.runEnd - turn.runStart);
    return Math.min(1, (turn.playedBase + run) / turn.scheduled);
  }

  /** Fade out and drop everything queued for playback (used for interruptions). */
  function cutPlayback() {
    resamplerRef.current = { pos: 0, prev: 0 };
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
  }

  /** The student chose to interrupt: stop the tutor now and let the mic through. */
  const interrupt = () => {
    discardAudioRef.current = true;
    gateRef.current.barge = true;
    turnAudioRef.current.frozen = getSpeechProgress();
    turnAudioRef.current.ended = true;
    cutPlayback();
  };

  const sendText = (content: string): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type: 'text', content }));
    return true;
  };

  const setPace = (pace: Pace) => { paceRef.current = PACE_RATES[pace]; };

  return { status, error, start, stop, sendText, levelsRef, getSpeechProgress, setPace, interrupt };
}
