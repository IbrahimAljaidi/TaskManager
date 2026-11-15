"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, Send, Sparkles, X } from "lucide-react";
import { friendlyError, runAgent, type AgentPhase, type Trace } from "@/lib/agent";
import type { Message } from "@/lib/domain";
import { useStore } from "@/lib/store";

type Props = { scope: string; open: boolean; setOpen: (value: boolean) => void };
const EMPTY_MESSAGES: Message[] = [];

const labels: Record<string, [string, string]> = {
  list_tasks: ["Read tasks", "قراءة المهام"],
  create_task: ["Create task", "إنشاء مهمة"],
  update_task: ["Update task", "تحديث مهمة"],
  move_task: ["Move task", "نقل مهمة"],
  delete_task: ["Delete task", "حذف مهمة"],
  batch_update: ["Update tasks", "تحديث مهام"],
  propose_project: ["Prepare project proposal", "إعداد مقترح مشروع"],
};

export default function Copilot({ scope, open, setOpen }: Props) {
  const messages = useStore(state => state.messages[scope]) || EMPTY_MESSAGES;
  const addMessage = useStore(state => state.addMessage);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<AgentPhase>("idle");
  const [live, setLive] = useState("");
  const [error, setError] = useState("");
  const [trace, setTrace] = useState<Trace[]>([]);
  const busyRef = useRef(false);
  const turnRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const turn = turnRef;
    const activeRequest = abortRef;
    return () => { turn.current++; activeRequest.current?.abort(); };
  }, []);

  useEffect(() => {
    const panel = scrollRef.current;
    if (panel) panel.scrollTop = panel.scrollHeight;
  }, [messages, live, trace, phase, error, scope, open]);

  async function send(value = input) {
    const message = value.trim();
    if (!message || busyRef.current) return;
    busyRef.current = true;
    const turn = ++turnRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setInput("");
    setBusy(true);
    setPhase("thinking");
    setLive("");
    setError("");
    setTrace([]);
    addMessage(scope, "user", message);
    try {
      const reply = await runAgent(
        message,
        scope,
        text => { if (turnRef.current === turn) setLive(text); },
        action => { if (turnRef.current === turn) setTrace(current => [...current.filter(item => item.id !== action.id), action]); },
        next => { if (turnRef.current === turn) setPhase(next); },
        controller.signal,
      );
      if (turnRef.current === turn && reply) addMessage(scope, "assistant", reply);
    } catch (cause) {
      if (turnRef.current === turn && !controller.signal.aborted) setError(friendlyError(cause, message));
    } finally {
      if (turnRef.current === turn) {
        busyRef.current = false;
        abortRef.current = null;
        setBusy(false);
        setPhase("idle");
        setLive("");
      }
    }
  }

  if (!open) return <button className="copilot-fab" onClick={() => setOpen(true)}><Sparkles size={18}/> AI Copilot</button>;
  const arabic = /[\u0600-\u06ff]/.test(messages.at(-1)?.content || input);
  const executing = trace.findLast(item => item.status === "pending");

  return <aside className="copilot" aria-label="TaskFlow AI Copilot">
    <div className="copilot-top"><div className="spark-icon"><Sparkles size={18}/></div><div><h2>TaskFlow AI Copilot</h2><span className="online">● &nbsp;Ready · {scope === "all" ? "All projects" : "Current project"}</span></div><button className="icon-btn close-chat" onClick={() => setOpen(false)} aria-label="Close copilot"><X size={18}/></button></div>
    <div className="chat-scroll" ref={scrollRef} role="log" aria-live="polite" aria-relevant="additions text">
      {messages.length === 0 && <div className="chat-welcome"><div className="orb">✦</div><h3>Work smarter, together.</h3><p>Ask me to plan a project, manage tasks, or make sense of your progress.</p><div className="suggestions">{["Create a new project", "What should I work on first?", "Summarize this board"].map(value => <button key={value} onClick={() => send(value)}><Sparkles size={14}/>{value}</button>)}</div></div>}
      {messages.map(message => <div key={message.id} className={"bubble " + message.role} dir="auto">{message.content}</div>)}
      {trace.map(action => <div className={"trace " + action.status} key={action.id} dir="auto"><Activity size={13}/><strong>{(labels[action.name] || ["Project action", "إجراء على المشروع"])[arabic ? 1 : 0]}</strong><span>· {action.status === "pending" ? (arabic ? "جارٍ التنفيذ" : "Executing") : action.status === "done" ? (arabic ? "اكتمل" : "Completed") : (arabic ? "تعذر التنفيذ" : "Failed")}</span><small>{action.detail}</small></div>)}
      {live && <div className="bubble assistant" dir="auto">{live}</div>}
      {busy && phase === "thinking" && <div className="thinking" role="status">{arabic ? "جارٍ التفكير" : "Thinking"}<span className="thinking-dots" aria-hidden="true"><i/><i/><i/></span></div>}
      {busy && phase === "executing" && <div className="executing" role="status">{arabic ? "جارٍ التنفيذ" : "Executing"}{executing ? ` · ${(labels[executing.name] || ["Project action", "إجراء على المشروع"])[arabic ? 1 : 0]}` : ""}<span className="thinking-dots" aria-hidden="true"><i/><i/><i/></span></div>}
      {error && <div className="chat-error" role="alert" dir="auto">{error}</div>}
    </div>
    <div className="chat-compose"><form onSubmit={event => { event.preventDefault(); send(); }}><input aria-label="Ask AI Copilot" dir="auto" value={input} onChange={event => setInput(event.target.value)} placeholder="Ask anything about your work..." disabled={busy}/><button className="send" type="submit" disabled={busy || !input.trim()} aria-label="Send message"><Send size={17}/></button></form><small>Relevant project context is sent to an external AI service when you use Copilot. Tasks stay in this browser.</small></div>
  </aside>;
}
