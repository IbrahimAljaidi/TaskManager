"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { blankTask, now, uid, type Message, type Project, type Proposal, type Task } from "./domain";
import type { Backup } from "./data-transfer";
import { proposalStartId, proposalSummary } from "./conversation";
type ProposalOrigin = { scope: string; startId: string | null };
type Data = { projects: Project[]; tasks: Task[]; selected: string; theme: "dark" | "light"; messages: Record<string, Message[]>; proposal: Proposal | null; proposalOrigin: ProposalOrigin | null; version: number; select: (id: string) => void; setTheme: (v: "dark" | "light") => void; createProject: (name: string, goal?: string, description?: string) => string; updateProject: (id: string, values: Pick<Project, "name" | "goal" | "description">) => void; removeProject: (id: string) => void; createFromProposal: (p: Proposal, language?: "en" | "ar") => string; setProposal: (p: Proposal | null, scope?: string) => void; upsertTask: (task: Task) => void; batchUpdate: (ids: string[], status?: Task["status"], tag?: string) => void; removeTask: (id: string) => void; reorder: (id: string, status: Task["status"], beforeId?: string) => void; addMessage: (scope: string, role: Message["role"], content: string) => void; importAsNew: (backup: Backup) => void; replaceProject: (backup: Backup, sourceId: string, targetId: string) => void; clearWorkspace: () => void };
export const useStore = create<Data>()(persist((set) => ({
  projects: [], tasks: [], selected: "", theme: "dark", messages: {}, proposal: null, proposalOrigin: null, version: 0,
  select: selected => set({ selected }),
  setTheme: theme => set({ theme }),
  createProject: (name, goal = "", description = "") => { const id = uid(); const stamp = now(); set(s => ({ projects: [...s.projects, { id, name: name.trim(), goal, description, createdAt: stamp, updatedAt: stamp }], selected: id, version: s.version + 1 })); return id; },
  updateProject: (id, values) => set(s => ({ projects: s.projects.map(p => p.id === id ? { ...p, ...values, name: values.name.trim(), updatedAt: now() } : p), version: s.version + 1 })),
  removeProject: id => set(s => { const messages = { ...s.messages }; delete messages[id]; return { projects: s.projects.filter(p => p.id !== id), tasks: s.tasks.filter(t => t.projectId !== id), selected: s.selected === id ? "all" : s.selected, messages, version: s.version + 1 }; }),
  createFromProposal: (p, language = "en") => {
    if (!p.name.trim() || p.tasks.some(t => !t.title.trim())) throw new Error("Invalid project proposal");
    const id = uid(), stamp = now();
    const project: Project = { id, name: p.name.trim(), goal: p.goal, description: p.description, createdAt: stamp, updatedAt: stamp };
    const tasks = p.tasks.map((t, order) => ({ ...blankTask(id, t.title), description: t.description || "", priority: t.priority || "medium", dueDate: t.dueDate || "", dueTime: t.dueDate ? t.dueTime || "" : "", dueTimeZone: t.dueDate ? t.dueTimeZone || "" : "", checklist: (t.checklist || []).map(c => ({ id: uid(), text: c.text, done: !!c.done })), order }));
    set(s => {
      const scope = s.proposalOrigin?.scope || s.selected || "all";
      const source = s.messages[scope] || [];
      const startId = s.proposalOrigin?.startId || proposalStartId(source, p.name);
      const start = source.findIndex(m => m.id === startId);
      const moved = start >= 0 ? source.slice(start) : [];
      const messages = { ...s.messages, [scope]: start >= 0 ? source.slice(0, start) : source };
      const entry = (role: Message["role"], content: string): Message => ({ id: uid(), role, content, at: now() });
      messages[id] = [...moved,
        entry("assistant", proposalSummary(p, language)),
        entry("user", language === "ar" ? "وافقت على إنشاء المشروع." : "Approved the project proposal."),
        entry("assistant", language === "ar" ? `تم إنشاء مشروع ${p.name} مع ${tasks.length} مهام.` : `Created project ${p.name} with ${tasks.length} tasks.`),
      ];
      return { projects: [...s.projects, project], tasks: [...s.tasks, ...tasks], messages, selected: id, proposal: null, proposalOrigin: null, version: s.version + 1 };
    });
    return id;
  },
  setProposal: (proposal, scope) => set(s => ({ proposal, proposalOrigin: proposal ? { scope: scope || s.selected || "all", startId: proposalStartId(s.messages[scope || s.selected || "all"] || [], proposal.name) } : null })),
  upsertTask: task => set(s => ({ tasks: s.tasks.some(t => t.id === task.id) ? s.tasks.map(t => t.id === task.id ? { ...task, updatedAt: now() } : t) : [...s.tasks, task], version: s.version + 1 })),
  batchUpdate: (ids, status, tag) => set(s => ({ tasks: s.tasks.map(t => ids.includes(t.id) ? { ...t, status: status || t.status, tags: tag ? [...new Set([...t.tags, tag])] : t.tags, updatedAt: now() } : t), version: s.version + 1 })),
  removeTask: id => set(s => ({ tasks: s.tasks.filter(t => t.id !== id), version: s.version + 1 })),
  reorder: (id, status, beforeId) => set(s => { const task = s.tasks.find(t => t.id === id); if (!task) return s; const peers = s.tasks.filter(t => t.projectId === task.projectId && t.status === status && t.id !== id).sort((a,b) => a.order - b.order); const at = beforeId ? peers.findIndex(t => t.id === beforeId) : -1; const order = at < 0 ? (peers.at(-1)?.order ?? 0) + 1 : at === 0 ? peers[0].order - 1 : (peers[at - 1].order + peers[at].order) / 2; return { tasks: s.tasks.map(t => t.id === id ? { ...t, status, order, updatedAt: now() } : t), version: s.version + 1 }; }),
  addMessage: (scope, role, content) => set(s => ({ messages: { ...s.messages, [scope]: [...(s.messages[scope] || []), { id: uid(), role, content, at: now() }].slice(-120) } })),
  importAsNew: backup => {
    const projectIds = new Map(backup.projects.map(p => [p.id, uid()]));
    const projects = backup.projects.map(p => ({ ...p, id: projectIds.get(p.id)! }));
    const tasks = backup.tasks.map(t => ({ ...t, id: uid(), projectId: projectIds.get(t.projectId)!, checklist: t.checklist.map(c => ({ ...c, id: uid() })) }));
    set(s => {
      const messages = { ...s.messages };
      for (const source of backup.projects) messages[projectIds.get(source.id)!] = (backup.conversations[source.id] || []).map(message => ({ ...message, id: uid() }));
      if (backup.conversations.all?.length) {
        const existingGlobal = messages.all || [];
        const usedIds = new Set(Object.values(messages).flat().map(message => message.id));
        const importedGlobal: Message[] = [];
        for (const message of backup.conversations.all) {
          if (existingGlobal.some(item => item.id === message.id && item.role === message.role && item.content === message.content && item.at === message.at)) continue;
          const id = usedIds.has(message.id) ? uid() : message.id;
          importedGlobal.push({ ...message, id });
          usedIds.add(id);
        }
        messages.all = [...(messages.all || []), ...importedGlobal];
      }
      return { projects: [...s.projects, ...projects], tasks: [...s.tasks, ...tasks], messages, selected: projects[0]?.id ?? s.selected, version: s.version + 1 };
    });
  },
  replaceProject: (backup, sourceId, targetId) => set(s => {
    const source = backup.projects.find(p => p.id === sourceId);
    const target = s.projects.find(p => p.id === targetId);
    if (!source || !target || source.name !== target.name || s.projects.filter(p => p.name === source.name).length !== 1) return s;
    const messages = { ...s.messages, [targetId]: (backup.conversations[sourceId] || []).map(message => ({ ...message, id: uid() })) };
    return { projects: s.projects.map(p => p.id === targetId ? { ...source, id: targetId } : p), tasks: [...s.tasks.filter(t => t.projectId !== targetId), ...backup.tasks.filter(t => t.projectId === sourceId).map(t => ({ ...t, id: uid(), projectId: targetId, checklist: t.checklist.map(c => ({ ...c, id: uid() })) }))], messages, selected: targetId, version: s.version + 1 };
  }),
  clearWorkspace: () => set(s => ({ projects: [], tasks: [], selected: "", messages: {}, proposal: null, proposalOrigin: null, version: s.version + 1 })),
}), { name: "taskflow-v1", version: 1, partialize: s => ({ projects: s.projects, tasks: s.tasks, selected: s.selected, theme: s.theme, messages: s.messages, proposal: s.proposal, proposalOrigin: s.proposalOrigin, version: s.version }) }));
