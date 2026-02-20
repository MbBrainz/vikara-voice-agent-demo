"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSession } from "@/app/actions";

type LogEntry = {
  id: string;
  type: "status" | "agent" | "user" | "tool";
  text: string;
};

// Lazy-loaded module cache — only imported when user clicks "Start a call"
let realtimeModule: typeof import("@/lib/realtime-agent") | null = null;

async function getRealtimeModule() {
  if (!realtimeModule) {
    realtimeModule = await import("@/lib/realtime-agent");
  }
  return realtimeModule;
}

const BAR_COUNT = 5;
const BAR_MIN = 8;
const BAR_MAX = 64;

export function VoiceAgent() {
  const sessionRef = useRef<unknown>(null);
  const [status, setStatus] = useState<
    "idle" | "connecting" | "connected" | "ending" | "error"
  >("idle");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isMuted, setIsMuted] = useState(false);

  const endingRef = useRef(false);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);

  // Audio visualization refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number>(0);
  const inputBarsRef = useRef<HTMLDivElement | null>(null);
  const outputBarsRef = useRef<HTMLDivElement | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  const addLog = useCallback(
    (type: LogEntry["type"], text: string) => {
      setLogs((prev) => [
        ...prev.slice(-49),
        { id: crypto.randomUUID(), type, text },
      ]);
    },
    [],
  );

  // Animation loop for audio visualization
  const startVisualization = useCallback(() => {
    let inputData: Uint8Array<ArrayBuffer> | null = null;
    let outputData: Uint8Array<ArrayBuffer> | null = null;

    const updateBars = (
      analyser: AnalyserNode | null,
      data: Uint8Array<ArrayBuffer> | null,
      container: HTMLDivElement | null,
    ): Uint8Array<ArrayBuffer> | null => {
      if (!analyser || !container) return data;
      if (!data || data.length !== analyser.frequencyBinCount) {
        data = new Uint8Array(analyser.frequencyBinCount);
      }
      analyser.getByteFrequencyData(data);
      const bars = container.children;
      const step = Math.max(1, Math.floor(data.length / BAR_COUNT));
      for (let i = 0; i < BAR_COUNT; i++) {
        const value = data[i * step] ?? 0;
        const height = BAR_MIN + ((value / 255) * (BAR_MAX - BAR_MIN));
        (bars[i] as HTMLElement | undefined)?.style.setProperty(
          "height",
          `${height}px`,
        );
      }
      return data;
    };

    const loop = () => {
      inputData = updateBars(inputAnalyserRef.current, inputData, inputBarsRef.current);
      outputData = updateBars(outputAnalyserRef.current, outputData, outputBarsRef.current);
      animationFrameRef.current = requestAnimationFrame(loop);
    };

    animationFrameRef.current = requestAnimationFrame(loop);
  }, []);

  const connect = useCallback(async () => {
    if (sessionRef.current) return;
    setStatus("connecting");
    addLog("status", "Requesting session...");

    try {
      // Get mic stream first
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      micStreamRef.current = micStream;

      // Set up AudioContext + input analyser
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;

      if (audioCtx.state === "suspended") await audioCtx.resume();

      const inputSource = audioCtx.createMediaStreamSource(micStream);
      const inputAnalyser = audioCtx.createAnalyser();
      inputAnalyser.fftSize = 256;
      inputSource.connect(inputAnalyser);
      inputAnalyserRef.current = inputAnalyser;

      // Create audio element for output playback
      const audioElement = document.createElement("audio");
      audioElement.autoplay = true;

      // Lazy-load the OpenAI SDK + agent setup only when needed
      const [{ clientSecret }, { agent, createRealtimeSession, setEndCallHandler }] =
        await Promise.all([createSession(), getRealtimeModule()]);

      addLog("status", "Session created, connecting...");

      const session = createRealtimeSession(agent, {
        mediaStream: micStream,
        audioElement,
      });

      session.on("agent_start", () => {
        if (endingRef.current) return;
        addLog("status", "Agent is listening...");
      });

      session.on("agent_tool_start", (_ctx: unknown, _agent: unknown, t: { name: string }) => {
        if (t.name === "end_call") return;
        addLog("tool", `Calling ${t.name}...`);
      });

      session.on("agent_tool_end", (_ctx: unknown, _agent: unknown, t: { name: string }, result: unknown) => {
        if (t.name === "end_call") return;
        addLog("tool", `${t.name}: ${typeof result === "string" ? result : "done"}`);
      });

      session.on("history_added", (item: { type: string; role?: string; content?: Array<Record<string, unknown>> }) => {
        if (item.type === "message" && item.role === "assistant") {
          const parts: string[] = [];
          for (const c of item.content ?? []) {
            if (c.type === "output_text" && c.text) parts.push(c.text as string);
            if (c.type === "output_audio" && c.transcript) parts.push(c.transcript as string);
          }
          if (parts.length) addLog("agent", parts.join(""));
        }
        if (item.type === "message" && item.role === "user") {
          const parts: string[] = [];
          for (const c of item.content ?? []) {
            if ("transcript" in c && c.transcript) parts.push(c.transcript as string);
          }
          if (parts.length) addLog("user", parts.join(""));
        }
      });

      session.on("error", (error: unknown) => {
        console.error("Session error:", error);
        addLog("status", `Error: ${error instanceof Error ? error.message : "Unknown"}`);
      });

      await session.connect({
        apiKey: clientSecret,
        model: "gpt-4o-realtime-preview",
      });

      // Set up output analyser from the peer connection's remote track
      type WebRTCTransport = import("@openai/agents/realtime").OpenAIRealtimeWebRTC;
      const transport = session.transport as unknown as WebRTCTransport;
      const pc = transport.connectionState.peerConnection;
      if (pc) {
        // Check if there are already remote tracks
        const receivers = pc.getReceivers();
        const audioReceiver = receivers.find(
          (r) => r.track && r.track.kind === "audio",
        );
        if (audioReceiver?.track) {
          const remoteStream = new MediaStream([audioReceiver.track]);
          const outputSource = audioCtx.createMediaStreamSource(remoteStream);
          const outputAnalyser = audioCtx.createAnalyser();
          outputAnalyser.fftSize = 256;
          outputSource.connect(outputAnalyser);
          outputAnalyserRef.current = outputAnalyser;
        }

        // Also listen for future tracks
        pc.addEventListener("track", (event) => {
          if (event.track.kind === "audio") {
            const remoteStream = new MediaStream([event.track]);
            const outputSource = audioCtx.createMediaStreamSource(remoteStream);
            const outputAnalyser = audioCtx.createAnalyser();
            outputAnalyser.fftSize = 256;
            outputSource.connect(outputAnalyser);
            outputAnalyserRef.current = outputAnalyser;
          }
        });
      }

      // Register end_call handler so the agent can hang up
      setEndCallHandler(() => {
        // Immediately transition UI
        endingRef.current = true;
        setStatus("ending");
        addLog("status", "Call ended");
        // Stop visualization right away
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = 0;
        }
        // Full cleanup after data channel has flushed
        setTimeout(() => disconnect(), 500);
      });

      startVisualization();
      sessionRef.current = session;
      setStatus("connected");
      addLog("status", "Connected — start speaking!");
    } catch (error) {
      console.error("Connection failed:", error);
      setStatus("error");
      addLog(
        "status",
        `Connection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      // Clean up on failure
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      audioContextRef.current?.close();
      audioContextRef.current = null;
      inputAnalyserRef.current = null;
      outputAnalyserRef.current = null;
      sessionRef.current = null;
    }
  }, [addLog, startVisualization]);

  const disconnect = useCallback(() => {
    // Cancel animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = 0;
    }

    // Close AudioContext
    audioContextRef.current?.close();
    audioContextRef.current = null;
    inputAnalyserRef.current = null;
    outputAnalyserRef.current = null;

    // Stop mic stream
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;

    // Clear end_call handler
    endingRef.current = false;
    realtimeModule?.setEndCallHandler(null);

    const session = sessionRef.current as { close: () => void } | null;
    session?.close();
    sessionRef.current = null;
    setStatus("idle");
    setIsMuted(false);
    addLog("status", "Disconnected");
  }, [addLog]);

  const toggleMute = useCallback(() => {
    const session = sessionRef.current as { mute: (v: boolean) => void; muted: boolean } | null;
    if (!session) return;
    const next = !isMuted;
    session.mute(next);
    setIsMuted(next);
  }, [isMuted]);

  // Auto-scroll logs to bottom
  useEffect(() => {
    const el = logsContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      audioContextRef.current?.close();
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <main className="flex min-h-svh flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg md:max-w-xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <div
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-4 py-1.5 text-sm font-medium text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300"
          >
            <span className="relative flex h-2 w-2" aria-hidden="true">
              {status === "connected" && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  status === "connected"
                    ? "bg-emerald-500"
                    : status === "connecting"
                      ? "bg-amber-500"
                      : "bg-zinc-400"
                }`}
              />
            </span>
            {status === "connected"
              ? "Live"
              : status === "connecting"
                ? "Connecting..."
                : status === "ending"
                  ? "Ending..."
                  : "Ready"}
          </div>
          <h1
            className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight"
            style={{
              backgroundImage: "linear-gradient(to right, #f5f3ff, #8b5cf6)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Vikara
          </h1>
          <p className="text-muted-foreground">
            Voice AI scheduling agent — book a product demo in seconds
          </p>
        </div>

        {/* Call Button */}
        <div className="flex justify-center">
          {status === "idle" || status === "error" ? (
            <button
              onClick={connect}
              aria-label="Start a call"
              className="group relative flex h-24 w-24 md:h-28 md:w-28 lg:h-32 lg:w-32 items-center justify-center rounded-full bg-violet-600 text-white shadow-lg shadow-violet-500/30 transition-all hover:scale-105 hover:bg-violet-700 hover:shadow-xl hover:shadow-violet-500/40 active:scale-95"
            >
              <span className="absolute inset-0 rounded-full bg-violet-600 opacity-0 group-hover:animate-ping group-hover:opacity-20" />
              <svg
                aria-hidden="true"
                focusable="false"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-8 w-8 md:h-10 md:w-10"
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            </button>
          ) : status === "connecting" || status === "ending" ? (
            <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-violet-300 dark:border-violet-700" role="status" aria-label={status === "ending" ? "Ending call" : "Connecting"}>
              <svg
                aria-hidden="true"
                focusable="false"
                className="h-8 w-8 animate-spin text-violet-600"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <button
                onClick={toggleMute}
                aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
                className={`flex h-14 w-14 items-center justify-center rounded-full border-2 transition-all ${
                  isMuted
                    ? "border-red-300 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-400"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                }`}
              >
                {isMuted ? (
                  <svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    <line x1="2" x2="22" y1="2" y2="22" />
                    <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
                    <path d="M5 10v2a7 7 0 0 0 12 5" />
                    <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
                    <line x1="12" x2="12" y1="19" y2="22" />
                  </svg>
                ) : (
                  <svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" x2="12" y1="19" y2="22" />
                  </svg>
                )}
              </button>

              {/* Active call visualizer */}
              <div aria-hidden="true" className="relative flex h-48 w-48 items-center justify-center">
                <span className="absolute inset-0 animate-ping rounded-full bg-violet-500 opacity-10" />
                <span className="absolute inset-4 animate-pulse rounded-full bg-violet-500 opacity-10" />
                <div className="relative flex h-40 w-40 items-center justify-center rounded-full bg-violet-600 text-white shadow-lg shadow-violet-500/30">
                  <div className="flex items-center gap-[6px]">
                    {/* Input bars (user mic) */}
                    <div ref={inputBarsRef} className="flex items-end gap-[4px]">
                      {Array.from({ length: BAR_COUNT }).map((_, i) => (
                        <span
                          key={`in-${i}`}
                          className="inline-block w-[6px] rounded-full bg-violet-300 transition-[height] duration-75"
                          style={{ height: BAR_MIN }}
                        />
                      ))}
                    </div>
                    {/* Divider */}
                    <span className="mx-[4px] inline-block h-12 w-[2px] bg-white/30" />
                    {/* Output bars (agent) */}
                    <div ref={outputBarsRef} className="flex items-end gap-[4px]">
                      {Array.from({ length: BAR_COUNT }).map((_, i) => (
                        <span
                          key={`out-${i}`}
                          className="inline-block w-[6px] rounded-full bg-white transition-[height] duration-75"
                          style={{ height: BAR_MIN }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={disconnect}
                aria-label="End call"
                className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition-all hover:scale-105 hover:bg-red-700 active:scale-95"
              >
                <svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
                  <line x1="23" x2="1" y1="1" y2="23" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {status === "idle" && (
          <p className="text-center text-sm text-muted-foreground">
            Press the microphone button to start a call
          </p>
        )}

        {/* Transcript */}
        {logs.length > 0 && (
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Transcript
            </h2>
            <div ref={logsContainerRef} role="log" aria-live="polite" aria-label="Call transcript" className="max-h-64 space-y-2 overflow-y-auto">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className={`text-sm ${
                    log.type === "agent"
                      ? "text-foreground"
                      : log.type === "user"
                        ? "text-violet-600 dark:text-violet-400"
                        : log.type === "tool"
                          ? "text-emerald-600 dark:text-emerald-400 font-mono text-xs"
                          : "text-muted-foreground text-xs italic"
                  }`}
                >
                  {log.type === "agent" && (
                    <span className="mr-1.5 font-semibold">Vikara:</span>
                  )}
                  {log.type === "user" && (
                    <span className="mr-1.5 font-semibold">You:</span>
                  )}
                  {log.text}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground">
          Powered by OpenAI Realtime API &middot; Built with Next.js
        </p>
      </div>
    </main>
  );
}
