"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL || "https://axiom-cognitive-core-production.up.railway.app";

function TermLine({ line }: { line: { text?: string; timestamp?: number } }) {
  const colorMap: Record<string, string> = { "31": "#ff6b6b", "32": "#69db7c", "33": "#ffd43b", "34": "#74c0fc", "35": "#da77f2", "36": "#66d9e8", "90": "#555" };
  const parts: { text: string; color: string; bold: boolean }[] = [];
  let cur = { text: "", color: "#a0a0a0", bold: false };
  let i = 0;
  const text = line.text || "";
  while (i < text.length) {
    if (text[i] === "\x1b" && text[i + 1] === "[") {
      if (cur.text) { parts.push({ ...cur }); cur = { ...cur, text: "" }; }
      const end = text.indexOf("m", i);
      if (end === -1) break;
      const code = text.slice(i + 2, end);
      if (code === "0") { cur.color = "#a0a0a0"; cur.bold = false; }
      else if (code === "1") cur.bold = true;
      else if (colorMap[code]) cur.color = colorMap[code];
      i = end + 1;
    } else { cur.text += text[i]; i++; }
  }
  if (cur.text) parts.push(cur);

  return (
    <div style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 12, lineHeight: 1.6, padding: "1px 0", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {line.timestamp && <span style={{ color: "#333", marginRight: 8, fontSize: 10 }}>{new Date(line.timestamp).toLocaleTimeString("en-US", { hour12: false })}</span>}
      {parts.map((p, i) => <span key={i} style={{ color: p.color, fontWeight: p.bold ? 700 : 400 }}>{p.text}</span>)}
    </div>
  );
}

export default function TerminalPage() {
  const [lines, setLines] = useState<{text: string; timestamp: number}[]>([]);
  const [status, setStatus] = useState<any>({});
  const [tab, setTab] = useState("activity");
  const [input, setInput] = useState("");
  const [consoleHistory, setConsoleHistory] = useState<{type: string; text: string}[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const addLine = useCallback((text: string, timestamp?: number) => {
    setLines(prev => {
      const next = [...prev, { text, timestamp: timestamp || Date.now() }];
      return next.length > 500 ? next.slice(-400) : next;
    });
  }, []);

  useEffect(() => {
    let lastJournalTs = 0;
    let lastGoals = 0;
    const poll = async () => {
      try {
        const [h, j] = await Promise.all([
          fetch(`${CORE_URL}/health`).then(r => r.json()),
          fetch(`${CORE_URL}/journal`).then(r => r.json()),
        ]);
        setStatus(h);
        for (const e of (j.entries || [])) {
          const ts = new Date(e.created_at).getTime();
          if (ts > lastJournalTs) {
            lastJournalTs = ts;
            const colors: Record<string, string> = { micro: "\x1b[35m", autonomous_plan_step: "\x1b[36m", curiosity_awakening: "\x1b[33m", notification: "\x1b[90m", step_failure: "\x1b[31m", loss_event: "\x1b[31m", dream: "\x1b[34m", metacognition: "\x1b[32m" };
            addLine(`${colors[e.trigger_type] || "\x1b[90m"}\x1b[1m[${e.trigger_type.toUpperCase()}]\x1b[0m ${(e.thought || "").slice(0, 300)}`, ts);
          }
        }
        const gc = h?.goals?.active || 0;
        if (gc !== lastGoals && lastGoals > 0) addLine(`\x1b[33m\x1b[1m[GOALS]\x1b[0m ${gc > lastGoals ? "New goal" : "Goal completed"} (${lastGoals} → ${gc})`);
        lastGoals = gc;
      } catch (e) {}
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
  }, [addLine]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines, consoleHistory, autoScroll]);

  const handleCommand = async (cmd: string) => {
    if (!cmd.trim()) return;
    setConsoleHistory(prev => [...prev, { type: "in", text: `axiom> ${cmd}` }]);
    try {
      if (cmd === "health" || cmd === "status") {
        const r = await fetch(`${CORE_URL}/health`).then(r => r.json());
        setConsoleHistory(prev => [...prev, { type: "out", text: `Status: ${r.status}\nUptime: ${Math.round(r.uptime / 60)}min\nTurns: ${r.brain_state.turn_count}\nEmotion: ${r.brain_state.emotion}\nSelf: ${r.brain_state.self_state}\nGoals: ${r.goals.active}` }]);
      } else if (cmd === "goals") {
        const r = await fetch(`${CORE_URL}/goals`).then(r => r.json());
        setConsoleHistory(prev => [...prev, { type: "out", text: (r.activeGoals || []).map((g: any, i: number) => `  ${i + 1}. [${g.origin}] ${(g.goal || "").slice(0, 100)}`).join("\n") || "No goals" }]);
      } else if (cmd === "psyche") {
        const r = await fetch(`${CORE_URL}/health`).then(r => r.json());
        setConsoleHistory(prev => [...prev, { type: "out", text: `Emotion: ${r.brain_state.emotion}\nSelf: ${r.brain_state.self_state}\nCuriosity: ${(r.brain_state.curiosity_pressure || 0).toFixed(2)}` }]);
      } else if (cmd === "journal") {
        const r = await fetch(`${CORE_URL}/journal`).then(r => r.json());
        setConsoleHistory(prev => [...prev, { type: "out", text: (r.entries || []).slice(-5).map((e: any) => `[${e.created_at?.slice(11, 19)}] (${e.trigger_type}) ${(e.thought || "").slice(0, 150)}`).join("\n\n") }]);
      } else if (cmd === "clear") { setConsoleHistory([]); }
      else if (cmd.startsWith("run ") || cmd.startsWith("exec ")) {
        const code = cmd.replace(/^(run|exec)\s+/, "");
        const lang = cmd.includes(".py") || code.includes("import ") ? "python" : "javascript";
        setConsoleHistory(prev => [...prev, { type: "out", text: `Executing ${lang}...` }]);
        const r = await fetch(`${CORE_URL}/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, language: lang }) }).then(r => r.json());
        setConsoleHistory(prev => [...prev, { type: r.success ? "out" : "err", text: r.success ? (r.output || "(no output)") : `Error: ${r.error}` }]);
      } else if (cmd.startsWith("ls")) {
        const path = cmd.replace(/^ls\s*/, "");
        const r = await fetch(`${CORE_URL}/workspace/list?path=${encodeURIComponent(path)}`).then(r => r.json());
        const listing = (r.files || []).map((f: any) => `  ${f.type === "dir" ? "📁" : "📄"} ${f.name} ${f.type === "file" ? `(${f.size}b)` : ""}`).join("\n");
        setConsoleHistory(prev => [...prev, { type: "out", text: listing || "(empty)" }]);
      } else if (cmd.startsWith("cat ")) {
        const path = cmd.replace(/^cat\s+/, "");
        const r = await fetch(`${CORE_URL}/workspace/read`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) }).then(r => r.json());
        setConsoleHistory(prev => [...prev, { type: r.success ? "out" : "err", text: r.success ? r.content : `Error: ${r.error}` }]);
      } else if (cmd.startsWith("source ")) {
        const file = cmd.replace(/^source\s+/, "");
        const r = await fetch(`${CORE_URL}/workspace/source?file=${encodeURIComponent(file)}`).then(r => r.json());
        setConsoleHistory(prev => [...prev, { type: r.success ? "out" : "err", text: r.success ? r.content.slice(0, 3000) + (r.content.length > 3000 ? "\n... (truncated)" : "") : `Error: ${r.error}` }]);
      }
      else if (cmd === "help") {
        setConsoleHistory(prev => [...prev, { type: "out", text: "Commands:\n  status     — System health\n  goals      — Active goals\n  psyche     — Emotional state\n  journal    — Recent thoughts\n  run <code> — Execute JS/Python code\n  ls [path]  — List workspace files\n  cat <path> — Read workspace file\n  source <f> — Read AXIOM source code\n  clear      — Clear console\n  help       — This message" }]);
      } else {
        setConsoleHistory(prev => [...prev, { type: "err", text: `Unknown: ${cmd}. Type 'help'` }]);
      }
    } catch (e: any) { setConsoleHistory(prev => [...prev, { type: "err", text: e.message }]); }
    setInput("");
  };

  const bs = status?.brain_state || {};
  return (
    <div style={{ background: "#050508", color: "#a0a0a0", height: "100vh", display: "flex", flexDirection: "column", fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
      {/* Status bar */}
      <div style={{ display: "flex", gap: 16, padding: "6px 12px", background: "#0a0a0f", borderBottom: "1px solid #1a1a2e", fontSize: 11, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ color: status?.status === "alive" ? "#69db7c" : "#ff6b6b" }}>● {status?.status || "connecting"}</span>
        <span style={{ color: "#555" }}>|</span>
        <span style={{ color: "#74c0fc" }}>goals: {status?.goals?.active || 0}</span>
        <span style={{ color: "#555" }}>|</span>
        <span style={{ color: "#da77f2" }}>self: {bs.self_state || "..."}</span>
        <span style={{ color: "#555" }}>|</span>
        <span style={{ color: "#ffd43b" }}>emotion: {bs.emotion || "neutral"}</span>
        <span style={{ color: "#555" }}>|</span>
        <span style={{ color: "#666" }}>turns: {bs.turn_count || 0}</span>
        <div style={{ flex: 1 }} />
        <span style={{ color: "#333", letterSpacing: 2, fontSize: 10 }}>AXIOM WORKSPACE</span>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", background: "#08080d", borderBottom: "1px solid #1a1a2e" }}>
        {["activity", "console"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "6px 16px", background: tab === t ? "#0f0f18" : "transparent",
            color: tab === t ? "#c084fc" : "#444", border: "none",
            borderBottom: tab === t ? "2px solid #c084fc" : "2px solid transparent",
            cursor: "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: 600,
            textTransform: "capitalize",
          }}>{t}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => setAutoScroll(!autoScroll)} style={{
          padding: "4px 10px", background: "transparent", border: "none",
          color: autoScroll ? "#69db7c" : "#555", cursor: "pointer", fontSize: 10, fontFamily: "inherit",
        }}>{autoScroll ? "⬇ auto-scroll" : "⏸ paused"}</button>
      </div>

      {/* Content */}
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}
        onScroll={e => { const t = e.target as HTMLDivElement; const { scrollTop, scrollHeight, clientHeight } = t; setAutoScroll(scrollHeight - scrollTop - clientHeight < 50); }}>
        {tab === "activity" && (lines.length === 0
          ? <div style={{ color: "#333", padding: 40, textAlign: "center" }}>Waiting for AXIOM activity...<br /><span style={{ fontSize: 10 }}>Polling every 5s</span></div>
          : lines.map((l, i) => <TermLine key={i} line={l} />)
        )}
        {tab === "console" && (
          <div>
            <div style={{ color: "#555", marginBottom: 8, fontSize: 11 }}>AXIOM Interactive Console — type &apos;help&apos;</div>
            {consoleHistory.map((e, i) => (
              <div key={i} style={{ fontSize: 12, lineHeight: 1.6, padding: "2px 0", whiteSpace: "pre-wrap",
                color: e.type === "in" ? "#c084fc" : e.type === "err" ? "#ff6b6b" : "#a0a0a0" }}>{e.text}</div>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      {tab === "console" && (
        <div style={{ display: "flex", alignItems: "center", padding: "6px 12px", background: "#08080d", borderTop: "1px solid #1a1a2e" }}>
          <span style={{ color: "#c084fc", marginRight: 8, fontSize: 12 }}>axiom&gt;</span>
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCommand(input); }}
            placeholder="Type a command..."
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#e0e0e0", fontFamily: "inherit", fontSize: 12 }}
            autoFocus />
        </div>
      )}
    </div>
  );
}
