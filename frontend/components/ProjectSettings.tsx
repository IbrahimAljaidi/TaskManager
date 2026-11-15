"use client";
import { useState } from "react";
import { Trash2, X } from "lucide-react";
import { type Project } from "@/lib/domain";
import { useStore } from "@/lib/store";
export default function ProjectSettings({ project, close }: { project: Project; close: () => void }) {
  const [name, setName] = useState(project.name), [goal, setGoal] = useState(project.goal), [description, setDescription] = useState(project.description);
  const update = useStore(s => s.updateProject), remove = useStore(s => s.removeProject), count = useStore(s => s.tasks.filter(t => t.projectId === project.id).length);
  return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><section className="modal compact" role="dialog" aria-modal="true" aria-label="Project settings"><div className="modal-head"><div><span className="eyebrow">PROJECT SETTINGS</span><h2>Edit project</h2></div><button className="icon-btn" aria-label="Close" onClick={close}><X size={18}/></button></div><label>Name<input value={name} maxLength={100} onChange={e => setName(e.target.value)}/></label><label>Goal<input value={goal} maxLength={1000} onChange={e => setGoal(e.target.value)}/></label><label>Description<textarea rows={4} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)}/></label><div className="modal-actions"><button className="danger" onClick={() => { if (window.confirm("Delete project " + project.name + " and its " + count + " tasks? This cannot be undone.")) { remove(project.id); close(); } }}><Trash2 size={15}/> Delete project</button><button className="ghost" onClick={close}>Cancel</button><button className="primary" disabled={!name.trim()} onClick={() => { update(project.id, { name, goal, description }); close(); }}>Save changes</button></div></section></div>;
}
