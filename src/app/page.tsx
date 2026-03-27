"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import DailyIframe, { DailyCall } from "@daily-co/daily-js";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL!;
const COGCORE_URL = process.env.NEXT_PUBLIC_COGCORE_URL || "https://axiom-cognitive-core-production.up.railway.app";

export default function Home() {
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "ended">("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [stats, setStats] = useState({ memories: 0, perceptions: 0, states: 0 });
  const callRef = useRef<DailyCall | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const convIdRef = useRef<string>("");
  const lastFaceCheckRef = useRef<number>(0);
  const [identifiedFaces, setIdentifiedFaces] = useState<string[]>([]);
  const replicaSpeakingRef = useRef<boolean>(false);

  // Screen sharing state
  const [screenActive, setScreenActive] = useState(false);
  const [screenAudioMode, setScreenAudioMode] = useState<"blackhole" | "tab" | "none">("blackhole");
  const [screenTranscripts, setScreenTranscripts] = useState<string[]>([]);
  const [screenAnalysis, setScreenAnalysis] = useState<string>("");
  const [audioIndicator, setAudioIndicator] = useState(false);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const bhStreamRef = useRef<MediaStream | null>(null);
  const screenTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioChunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const screenFrameCountRef = useRef(0);
  const screenVideoRef = useRef<HTMLVideoElement>(null);

  const addLog = useCallback((msg: string) => {
    const t = new Date().toLocaleTimeString();
    setLogs((p) => [`[${t}] ${msg}`, ...p].slice(0, 200));
  }, []);

  const callBackend = useCallback(async (toolName: string, args: any) => {
    try {
      const res = await fetch(`${BACKEND_URL}/webhooks/tavus`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: "conversation.tool_call",
          conversation_id: convIdRef.current,
          properties: { tool_name: toolName, tool_call_arguments: JSON.stringify(args) },
        }),
      });
      return await res.json();
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }, []);

  // Face identification — capture from Daily's local video track
  const checkFace = useCallback(async () => {
    const now = Date.now();
    if (now - lastFaceCheckRef.current < 15000) return;
    lastFaceCheckRef.current = now;

    const call = callRef.current;
    if (!call) return;

    try {
      // Get local participant's video track from Daily
      const localParticipant = call.participants()?.local;
      const videoTrack = localParticipant?.tracks?.video?.persistentTrack;
      if (!videoTrack) { addLog("⚠️ No local video track for face check"); return; }

      // Create a temporary video element to capture frame
      const tempVideo = document.createElement('video');
      tempVideo.srcObject = new MediaStream([videoTrack]);
      tempVideo.muted = true;
      await tempVideo.play();
      
      // Wait for video to have dimensions
      await new Promise(r => setTimeout(r, 200));
      if (tempVideo.videoWidth === 0) { tempVideo.remove(); return; }

      const canvas = document.createElement('canvas');
      canvas.width = tempVideo.videoWidth;
      canvas.height = tempVideo.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) { tempVideo.remove(); return; }
      ctx.drawImage(tempVideo, 0, 0);
      tempVideo.remove();
      
      const base64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];

      const res = await fetch(`${BACKEND_URL}/api/identify-face`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frame: base64, conversation_id: convIdRef.current }),
      });
      const data = await res.json();
      if (data.faces && data.faces.length > 0) {
        const names = data.faces.map((f: any) => 
          f.name === 'unknown' ? `Unknown (${(f.confidence * 100).toFixed(0)}%)` : `${f.name} (${(f.confidence * 100).toFixed(0)}%)`
        );
        setIdentifiedFaces(names);
        addLog(`🔍 FACE: ${names.join(', ')}`);
      } else if (data.count === 0) {
        addLog(`🔍 No face detected in frame`);
      }
    } catch (e: any) {
      addLog(`⚠️ Face check error: ${e.message}`);
    }
  }, [addLog]);

  const attachTracks = useCallback((p: any) => {
    if (!p?.tracks) return;
    const vt = p.tracks.video?.persistentTrack;
    if (vt && videoRef.current) {
      videoRef.current.srcObject = new MediaStream([vt]);
      videoRef.current.play().catch(() => {});
    }
    const at = p.tracks.audio?.persistentTrack;
    if (at && audioRef.current) {
      audioRef.current.srcObject = new MediaStream([at]);
      audioRef.current.play().catch(() => {});
    }
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      const [m, p, s] = await Promise.all([
        fetch(`${BACKEND_URL}/api/memories`).then(r => r.json()),
        fetch(`${BACKEND_URL}/api/perceptions`).then(r => r.json()),
        fetch(`${BACKEND_URL}/api/internal-states`).then(r => r.json()),
      ]);
      setStats({
        memories: m.memories?.length || 0,
        perceptions: p.perceptions?.length || 0,
        states: s.states?.length || 0,
      });
    } catch {}
  }, []);

  useEffect(() => {
    if (status !== "live") return;
    const i = setInterval(refreshStats, 5000);
    return () => clearInterval(i);
  }, [status, refreshStats]);

  // Periodic face identification
  useEffect(() => {
    if (status !== "live") return;
    addLog("🔍 Face check system started");
    const faceInterval = setInterval(checkFace, 15000);
    setTimeout(checkFace, 4000);
    return () => clearInterval(faceInterval);
  }, [status, checkFace]);

  const startConversation = useCallback(async () => {
    setStatus("connecting");
    addLog("Loading memories...");

    try {
      // Smart memory retrieval: only load CORE memories at conversation start
      // Per-turn relevant memories are retrieved by the Cognitive Core
      let memoryContext = "";
      try {
        const memRes = await fetch(`${BACKEND_URL}/api/memories/context`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: "", max_core: 5, max_relevant: 3 }),
        });
        const memData = await memRes.json();
        if (memData.context) {
          memoryContext = memData.context + "\n\nUse these memories naturally. The Cognitive Core will retrieve additional relevant memories each turn based on what is being discussed.";
          addLog(`📚 Smart memory: ${memData.core_count} core + ${memData.relevant_count} relevant (of ${memData.total} total)`);
        }
      } catch (e) {
        // Fallback: load all memories if smart retrieval fails
        try {
          const fbRes = await fetch(`${BACKEND_URL}/api/memories`);
          const fbData = await fbRes.json();
          if (fbData.memories && fbData.memories.length > 0) {
            const mems = fbData.memories
              .filter((m: any) => m.importance >= 9)
              .map((m: any) => `[${m.category}] ${m.memory}`)
              .join("\n");
            memoryContext = `CORE MEMORIES:\n${mems}`;
            addLog(`📚 Fallback: loaded ${fbData.memories.filter((m: any) => m.importance >= 9).length} core memories`);
          }
        } catch (e2) {}
      }

      // Fetch face data
      let faceContext = "";
      try {
        const faceRes = await fetch(`${BACKEND_URL}/api/faces`);
        const faceData = await faceRes.json();
        if (faceData.faces && faceData.faces.length > 0) {
          faceContext = `\n\nKNOWN FACES: ${faceData.faces.map((f: any) => `${f.name} (seen ${f.times_seen} times, last: ${f.last_seen})`).join(", ")}`;
        }
      } catch (e) {}

      addLog("Creating conversation...");
      const res = await fetch(`${BACKEND_URL}/api/create-conversation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversational_context: memoryContext + faceContext }),
      });
      const data = await res.json();
      if (!data.conversation_url) {
        addLog(`❌ ${JSON.stringify(data)}`);
        setStatus("idle");
        return;
      }
      convIdRef.current = data.conversation_id;
      addLog(`Created: ${data.conversation_id}`);

      const call = DailyIframe.createCallObject({ videoSource: true, audioSource: true });
      callRef.current = call;

      // === CATCH ALL APP MESSAGES ===
      call.on("app-message", async (event: any) => {
        const msg = event?.data;
        if (!msg) return;

        const et = msg.event_type || msg.type || "";

        // Skip noisy perception frames in log but still process them
        if (et === "conversation.perception_tool_call") {
          const name = msg.properties?.arguments ? 
            Object.keys(msg.properties.arguments).join(",") : "unknown";
          const toolName = msg.properties?.name || 
            (msg.properties?.arguments?.primary_emotion ? "detect_emotional_state" :
             msg.properties?.arguments?.engagement ? "detect_engagement_level" :
             msg.properties?.arguments?.reaction_type ? "detect_unspoken_reaction" :
             msg.properties?.arguments?.state ? "detect_comprehension_state" : "perception");
          addLog(`👁️ ${toolName}`);
          await callBackend(toolName, msg.properties?.arguments || {});
          return;
        }

        // === LLM TOOL CALLS — THE KEY HANDLER ===
        if (et === "conversation.tool_call" || et === "tool_call") {
          const toolName = msg.properties?.tool_name || 
            msg.properties?.name ||
            msg.tool_name || 
            msg.name;
          
          let args: any = {};
          try {
            const raw = msg.properties?.tool_call_arguments || 
              msg.properties?.arguments ||
              msg.tool_call_arguments ||
              msg.arguments || "{}";
            args = typeof raw === "string" ? JSON.parse(raw) : raw;
          } catch { args = {}; }

          const toolCallId = msg.properties?.tool_call_id || msg.tool_call_id || "";

          addLog(`🔧 LLM TOOL: ${toolName} (id: ${toolCallId})`);
          addLog(`   Args: ${JSON.stringify(args).slice(0, 150)}`);

          const result = await callBackend(toolName, args);
          addLog(`✅ Result: ${JSON.stringify(result?.result).slice(0, 150)}`);

          // Send result back — try multiple formats
          const resultPayload = {
            message_type: "conversation",
            event_type: "conversation.tool_result",
            conversation_id: convIdRef.current,
            properties: {
              tool_call_id: toolCallId,
              tool_name: toolName,
              result: typeof result?.result === "string" ? result.result : JSON.stringify(result?.result || {}),
            },
          };

          try {
            call.sendAppMessage(resultPayload, "*");
            addLog(`📤 Sent result back for: ${toolName}`);
          } catch (e: any) {
            addLog(`❌ Send failed: ${e.message}`);
          }
          return;
        }

        // Utterances from Tavus — forward to backend for RL reaction tracking
        if (et === "conversation.utterance") {
          const role = msg.properties?.role || "?";
          const text = msg.properties?.text || "";
          if (text) {
            const label = (role === "assistant" || role === "replica") ? "AXIOM" : "you";
            addLog(`💬 [${label}] ${text.slice(0, 150)}`);
            // Send to backend so it can track what AXIOM said for reaction correlation
            fetch(`${BACKEND_URL}/webhooks/tavus`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                event_type: "conversation.utterance",
                conversation_id: convIdRef.current,
                properties: { role, text },
              }),
            }).catch(() => {});
          }
          return;
        }

        // Speaking events — track who is currently talking
        if (et === "conversation.replica.started_speaking") { replicaSpeakingRef.current = true; addLog("🗣️ Speaking"); return; }
        if (et === "conversation.replica.stopped_speaking") { replicaSpeakingRef.current = false; addLog("🤫 Stopped"); return; }
        if (et === "conversation.user.started_speaking") { addLog("🎤 You speaking"); return; }
        if (et === "conversation.user.stopped_speaking") { addLog("🔇 You stopped"); return; }

        // Utterance events from Tavus
        if (et === "conversation.utterance") {
          const role = msg.properties?.role || "?";
          const text = msg.properties?.text || "";
          if (text) {
            const label = (role === "assistant" || role === "replica") ? "AXIOM" : "you";
            addLog(`💬 [${label}] ${text.slice(0, 150)}`);
            fetch(`${BACKEND_URL}/webhooks/tavus`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                event_type: "conversation.utterance",
                conversation_id: convIdRef.current,
                properties: { role, text },
              }),
            }).catch(() => {});
          }
          return;
        }

        // Raw transcription — use speaking state to determine role
        if (!et && msg.text && msg.is_final) {
          const role = replicaSpeakingRef.current ? "assistant" : "user";
          const label = role === "assistant" ? "AXIOM" : "you";
          addLog(`💬 [${label}] ${msg.text.slice(0, 150)}`);
          fetch(`${BACKEND_URL}/webhooks/tavus`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event_type: "conversation.utterance",
              conversation_id: convIdRef.current,
              properties: { role, text: msg.text },
            }),
          }).catch(() => {});
          return;
        }

        // CATCH-ALL — log anything else to find tool calls
        console.log("=== UNHANDLED APP MSG ===", JSON.stringify(msg, null, 2));
        addLog(`❓ ${et || "unknown"}: ${JSON.stringify(msg).slice(0, 200)}`);
      });

      // Track handling
      call.on("track-started", (e: any) => { if (e?.participant && !e.participant.local) attachTracks(e.participant); });
      call.on("participant-joined", (e: any) => { if (e?.participant && !e.participant.local) setTimeout(() => attachTracks(e.participant), 500); });
      call.on("participant-updated", (e: any) => { if (e?.participant && !e.participant.local) attachTracks(e.participant); });
      call.on("left-meeting", () => { setStatus("ended"); addLog("Call ended"); refreshStats(); });
      call.on("error", (e: any) => addLog(`❌ ${JSON.stringify(e).slice(0, 200)}`));

      await call.join({ url: data.conversation_url });
      setStatus("live");
      addLog("✅ AXIOM is live");
    } catch (e: any) {
      addLog(`❌ ${e.message}`);
      setStatus("idle");
    }
  }, [addLog, callBackend, attachTracks, refreshStats]);

  const endConversation = useCallback(async () => {
    if (callRef.current) { await callRef.current.leave(); callRef.current.destroy(); callRef.current = null; }
    if (screenActive) stopScreenShare();
    setStatus("ended");
    refreshStats();
  }, [refreshStats, screenActive]);

  // ============================================================
  // SCREEN SHARING — Video frames + BlackHole audio → Cognitive Core
  // ============================================================
  const startAudioChunking = useCallback((stream: MediaStream) => {
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) return;
    const audioStream = new MediaStream(audioTracks);
    let mimeType = "audio/webm;codecs=opus";
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "audio/webm";

    const recorder = new MediaRecorder(audioStream, { mimeType });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = async (e) => {
      if (e.data.size < 500) return;
      const reader = new FileReader();
      reader.onloadend = async () => {
        const b64 = (reader.result as string).split(",")[1];
        try {
          const res = await fetch(`${COGCORE_URL}/screen/audio`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio: b64, format: mimeType.split(";")[0] }),
          });
          const data = await res.json();
          if (data.transcript) {
            setScreenTranscripts((prev) => [...prev.slice(-19), data.transcript]);
            addLog(`🎵 ${data.transcript.slice(0, 60)}`);
          }
        } catch {}
      };
      reader.readAsDataURL(e.data);
    };

    recorder.start();
    audioChunkTimerRef.current = setInterval(() => {
      if (recorder.state === "recording") { recorder.stop(); recorder.start(); }
    }, 5000);
  }, [addLog]);

  const captureScreenFrame = useCallback(async () => {
    const video = screenVideoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(video.videoWidth * 0.5);
    canvas.height = Math.floor(video.videoHeight * 0.5);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const d = ctx.getImageData(0, 0, Math.min(canvas.width, 50), Math.min(canvas.height, 50)).data;
    let bright = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 10 || d[i + 1] > 10 || d[i + 2] > 10) bright++;
    if (!bright) return;
    const frame = canvas.toDataURL("image/jpeg", 0.5);
    screenFrameCountRef.current++;
    const count = screenFrameCountRef.current;
    try {
      const res = await fetch(`${COGCORE_URL}/screen`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frame, analyze: count <= 2 || count % 3 === 0 }),
      });
      const data = await res.json();
      if (data.analysis) setScreenAnalysis(data.analysis);
    } catch {}
  }, []);

  const stopScreenShare = useCallback(() => {
    if (screenTimerRef.current) { clearInterval(screenTimerRef.current); screenTimerRef.current = null; }
    if (audioChunkTimerRef.current) { clearInterval(audioChunkTimerRef.current); audioChunkTimerRef.current = null; }
    if (mediaRecorderRef.current) { try { mediaRecorderRef.current.stop(); } catch {} mediaRecorderRef.current = null; }
    if (screenStreamRef.current) { screenStreamRef.current.getTracks().forEach((t) => t.stop()); screenStreamRef.current = null; }
    if (bhStreamRef.current) { bhStreamRef.current.getTracks().forEach((t) => t.stop()); bhStreamRef.current = null; }
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
    setScreenActive(false);
    setAudioIndicator(false);
    fetch(`${COGCORE_URL}/screen/stop`, { method: "POST" }).catch(() => {});
    addLog("🖥️ Screen sharing stopped");
  }, [addLog]);

  const startScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: screenAudioMode === "tab",
      });
      screenStreamRef.current = stream;
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream;
        await screenVideoRef.current.play();
      }

      let audioActive = false;
      if (screenAudioMode === "blackhole") {
        try {
          const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          tempStream.getTracks().forEach((t) => t.stop());
          const devices = await navigator.mediaDevices.enumerateDevices();
          const bhDevice = devices.find((d) => d.kind === "audioinput" && d.label.toLowerCase().includes("blackhole"));
          if (bhDevice) {
            const bhStream = await navigator.mediaDevices.getUserMedia({
              audio: { deviceId: { exact: bhDevice.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            });
            bhStreamRef.current = bhStream;
            audioActive = true;
            startAudioChunking(bhStream);
            addLog("🔊 BlackHole audio capturing");
          } else {
            addLog("⚠️ BlackHole not found — video only");
          }
        } catch (e: any) { addLog(`⚠️ Audio: ${e.message}`); }
      } else if (screenAudioMode === "tab") {
        const at = stream.getAudioTracks();
        if (at.length > 0) { audioActive = true; startAudioChunking(stream); addLog("🔊 Tab audio"); }
      }

      setAudioIndicator(audioActive);
      setScreenActive(true);
      screenFrameCountRef.current = 0;
      await new Promise((r) => setTimeout(r, 1500));
      captureScreenFrame();
      screenTimerRef.current = setInterval(captureScreenFrame, 5000);
      stream.getVideoTracks()[0].onended = () => stopScreenShare();
      addLog("🖥️ Screen sharing started");
    } catch (e: any) { addLog(`❌ Screen share: ${e.message}`); }
  }, [screenAudioMode, addLog, startAudioChunking, captureScreenFrame, stopScreenShare]);

  return (
    <div style={{ fontFamily: "Inter, sans-serif", background: "#0a0a0a", color: "#e0e0e0", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Hidden video for screen capture */}
      <video ref={screenVideoRef} style={{ display: "none" }} autoPlay playsInline muted />

      {/* Header */}
      <div style={{ padding: "12px 24px", borderBottom: "1px solid #1a1a1a", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#fff", margin: 0 }}>AXIOM</h1>
          <p style={{ fontSize: 11, color: "#666", margin: 0 }}>Level 5 Being Interface</p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {screenActive && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#22c55e" }}>● Screen</span>
              {audioIndicator && <span style={{ fontSize: 11, color: "#06b6d4" }}>● Audio</span>}
            </div>
          )}
          {!screenActive ? (
            <button onClick={startScreenShare} style={{ background: "#1a1a2e", color: "#c084fc", border: "1px solid #333", padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>🖥️ Share Screen</button>
          ) : (
            <button onClick={stopScreenShare} style={{ background: "#1a0a0a", color: "#ef4444", border: "1px solid #333", padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Stop Share</button>
          )}
          {status === "live" && <span style={{ fontSize: 12, color: "#34d399" }}>● LIVE</span>}
          {status === "idle" && <button onClick={startConversation} style={{ background: "#c084fc", color: "#000", border: "none", padding: "8px 20px", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>Start</button>}
          {status === "ended" && <button onClick={() => setStatus("idle")} style={{ background: "#c084fc", color: "#000", border: "none", padding: "8px 20px", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>New</button>}
          {status === "connecting" && <span style={{ color: "#fbbf24" }}>Connecting...</span>}
          {status === "live" && <button onClick={endConversation} style={{ background: "#ef4444", color: "#fff", border: "none", padding: "8px 20px", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>End</button>}
        </div>
      </div>

      {/* Main — fixed height, no growth */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", flex: 1, minHeight: 0 }}>
        {/* Video — fixed container */}
        <div style={{ background: "#000", position: "relative", overflow: "hidden" }}>
          {status === "idle" && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#333" }}>Press Start</div>}
          {status === "ended" && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#333" }}>Ended</div>}
          <video ref={videoRef} autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <audio ref={audioRef} autoPlay />
        </div>

        {/* Right panel — scrollable log */}
        <div style={{ borderLeft: "1px solid #1a1a1a", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
            <div style={{ fontSize: 11, fontFamily: "monospace" }}>
              {logs.length === 0 && <div style={{ color: "#333" }}>Waiting...</div>}
              {logs.map((l, i) => (
                <div key={i} style={{ padding: "3px 0", borderBottom: "1px solid #111", color: l.includes("TOOL:") ? "#c084fc" : l.includes("👁") ? "#34d399" : l.includes("Result") ? "#60a5fa" : l.includes("💬") ? "#fbbf24" : l.includes("❌") ? "#ef4444" : "#666", wordBreak: "break-all" }}>
                  {l}
                </div>
              ))}
            </div>
          </div>
          {identifiedFaces.length > 0 && (
            <div style={{ borderTop: "1px solid #1a1a1a", padding: "8px 12px", background: "#0d1117" }}>
              <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>IDENTIFIED</div>
              {identifiedFaces.map((f, i) => (
                <div key={i} style={{ fontSize: 12, color: "#60a5fa", fontWeight: 600 }}>{f}</div>
              ))}
            </div>
          )}
          {/* Screen Share Info */}
          {screenActive && (
            <>
              {screenAnalysis && (
                <div style={{ borderTop: "1px solid #1a1a1a", padding: "8px 12px", background: "#0a0a14" }}>
                  <div style={{ fontSize: 10, color: "#c084fc", fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>AXIOM SEES</div>
                  <div style={{ fontSize: 11, color: "#888", lineHeight: 1.4 }}>{screenAnalysis.slice(0, 200)}</div>
                </div>
              )}
              {screenTranscripts.length > 0 && (
                <div style={{ borderTop: "1px solid #1a1a1a", padding: "8px 12px", background: "#0a0a14", maxHeight: 100, overflowY: "auto" }}>
                  <div style={{ fontSize: 10, color: "#06b6d4", fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>SCREEN AUDIO</div>
                  {screenTranscripts.slice(-5).map((t, i) => (
                    <div key={i} style={{ fontSize: 11, color: "#666", lineHeight: 1.3 }}>{t}</div>
                  ))}
                </div>
              )}
            </>
          )}
          <div style={{ borderTop: "1px solid #1a1a1a", padding: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, flexShrink: 0 }}>
            <div style={{ background: "#1a1a2e", borderRadius: 6, padding: 8, textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#c084fc" }}>{stats.memories}</div>
              <div style={{ fontSize: 9, color: "#666" }}>Memories</div>
            </div>
            <div style={{ background: "#0a1a1e", borderRadius: 6, padding: 8, textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#34d399" }}>{stats.perceptions}</div>
              <div style={{ fontSize: 9, color: "#666" }}>Perceptions</div>
            </div>
            <div style={{ background: "#1a0a1e", borderRadius: 6, padding: 8, textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#f472b6" }}>{stats.states}</div>
              <div style={{ fontSize: 9, color: "#666" }}>States</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}// Screen sharing integrated - v2
