"use client";
import { useState } from "react";
import { Trash2, X } from "lucide-react";
import { type Project } from "@/lib/domain";
import { useStore } from "@/lib/store";
import { localize, useUiLanguage } from "@/components/UiLanguage";
export default function ProjectSettings({ project, close }: { project: Project; close: () => void }) {
  const language = useUiLanguage();
  const tr = (en: string, ar: string) => localize(language, en, ar);
  const [name, setName] = useState(project.name), [goal, setGoal] = useState(project.goal), [description, setDescription] = useState(project.description);
  const update = useStore(s => s.updateProject), remove = useStore(s => s.removeProject), count = useStore(s => s.tasks.filter(t => t.projectId === project.id).length);
  return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><section className="modal compact" role="dialog" aria-modal="true" aria-label="Project settings"><div className="modal-head"><div><span className="eyebrow">{tr("PROJECT SETTINGS", "إعدادات المشروع")}</span><h2>{tr("Edit project", "تعديل المشروع")}</h2></div><button className="icon-btn" aria-label="Close" onClick={close}><X size={18}/></button></div><label>{tr("Name", "الاسم")}<input value={name} maxLength={100} onChange={e => setName(e.target.value)} dir="auto"/></label><label>{tr("Goal", "الهدف")}<input value={goal} maxLength={1000} onChange={e => setGoal(e.target.value)} dir="auto"/></label><label>{tr("Description", "الوصف")}<textarea rows={4} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} dir="auto"/></label><div className="modal-actions"><button className="danger" onClick={() => { if (window.confirm(tr("Delete project " + project.name + " and its " + count + " tasks? This cannot be undone.", "حذف المشروع " + project.name + " ومهامه وعددها " + count + "؟ لا يمكن التراجع."))) { remove(project.id); close(); } }}><Trash2 size={15}/> {tr("Delete project", "حذف المشروع")}</button><button className="ghost" onClick={close}>{tr("Cancel", "إلغاء")}</button><button className="primary" disabled={!name.trim()} onClick={() => { update(project.id, { name, goal, description }); close(); }}>{tr("Save changes", "حفظ التغييرات")}</button></div></section></div>;
}
