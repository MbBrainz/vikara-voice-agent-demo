import { VoiceAgent } from "@/components/voice-agent";

export default function Home() {
  return (
    <>
      <VoiceAgent />
      <section className="flex justify-center px-4 pb-12">
        <div className="w-full max-w-lg md:max-w-xl rounded-xl border border-violet-500/20 bg-violet-950/40 px-6 py-5 text-center text-sm text-violet-200/80">
          Want to try a similar voice agent that runs entirely in your browser
          — no API key needed?{" "}
          <a
            href="https://ttslab.dev/voice-agent"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-violet-400 underline underline-offset-2 hover:text-violet-300 transition-colors"
          >
            ttslab.dev/voice-agent
          </a>
        </div>
      </section>
    </>
  );
}
