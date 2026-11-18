"use client";

import { useRef, useState } from "react";
import { ChevronDown, Database, Download, Upload, Trash2, X } from "lucide-react";
import { backupFilename, makeBackup, parseBackup, type Backup } from "@/lib/data-transfer";
import { useStore } from "@/lib/store";
import { localize, useUiLanguage } from "./UiLanguage";

type Dialog = "export" | "import" | "clear" | null;
function downloadBackup(backup: Backup, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SidebarData() {
  const language = useUiLanguage(); const tr = (en: string, ar: string) => localize(language, en, ar);
  const projects = useStore(s => s.projects), tasks = useStore(s => s.tasks), messages = useStore(s => s.messages);
  const importAsNew = useStore(s => s.importAsNew), replaceProject = useStore(s => s.replaceProject), clearWorkspace = useStore(s => s.clearWorkspace);
  const [menu, setMenu] = useState(false), [dialog, setDialog] = useState<Dialog>(null), [exportId, setExportId] = useState("all"), [backup, setBackup] = useState<Backup | null>(null), [sourceId, setSourceId] = useState(""), [mode, setMode] = useState<"new" | "replace">("new"), [confirmation, setConfirmation] = useState(""), [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const close = () => { setDialog(null); setConfirmation(""); setBackup(null); setNotice(""); };
  const exportData = (projectId?: string) => {
    try { const project = projects.find(p => p.id === projectId); downloadBackup(makeBackup(projects, tasks, projectId, messages), backupFilename(project)); setNotice(tr("Backup downloaded.", "تم تنزيل النسخة الاحتياطية.")); }
    catch { setNotice(tr("Could not export the selected data.", "تعذر تصدير البيانات المحددة.")); }
  };
  const matching = backup?.projects.find(p => p.id === sourceId);
  const matches = matching ? projects.filter(p => p.name === matching.name) : [];
  const canReplace = !!matching && matches.length === 1 && backup?.projects.filter(p => p.name === matching.name).length === 1;
  const pickFile = async (file?: File) => {
    setBackup(null); setNotice(""); setMode("new"); setConfirmation("");
    if (!file) return;
    try {
      if (file.size > 8_000_000) throw new Error("large");
      const parsed = parseBackup(await file.text()); setBackup(parsed); setSourceId(parsed.projects[0]?.id || "");
    } catch { setNotice(tr("This file is not a valid TaskFlow version 1 backup. No data was changed.", "هذا الملف ليس نسخة TaskFlow صالحة من الإصدار 1. لم تتغير أي بيانات.")); }
  };
  const applyImport = () => {
    if (!backup) return;
    if (mode === "replace") {
      if (!canReplace || confirmation !== "REPLACE") return;
      replaceProject(backup, sourceId, matches[0].id);
      setNotice(tr("Matching project replaced.", "تم استبدال المشروع المطابق."));
    } else { importAsNew(backup); setNotice(tr("Projects imported as new.", "تم استيراد المشاريع كمشاريع جديدة.")); }
    setBackup(null); setConfirmation(""); setDialog(null);
  };
  return <div className="data-control" onKeyDown={e => { if (e.key === "Escape") { setMenu(false); close(); } }}>
    <button className="data-button" aria-label={tr("Data", "البيانات")} title={tr("Data", "البيانات")} aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu(!menu)}><Database size={17}/><span className="sidebar-label">{tr("Data", "البيانات")}</span><ChevronDown size={14} className="data-chevron"/></button>
    {menu && <div className="data-menu" role="menu" aria-label={tr("Data actions", "إجراءات البيانات")}>
      {([ ["export", Download, tr("Export", "تصدير")], ["import", Upload, tr("Import", "استيراد")], ["clear", Trash2, tr("Clear", "مسح")] ] as const).map(([action, Icon, label]) => <button key={action} role="menuitem" onClick={() => { setDialog(action); setMenu(false); setNotice(""); setConfirmation(""); if (action === "export") setExportId("all"); }}><Icon size={16}/>{label}</button>)}
    </div>}
    {notice && !dialog && <span className="data-notice" role="status">{notice}</span>}
    {dialog && <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><section className="modal compact data-dialog" role="dialog" aria-modal="true" aria-label={dialog === "export" ? tr("Export data", "تصدير البيانات") : dialog === "import" ? tr("Import data", "استيراد البيانات") : tr("Clear data", "مسح البيانات")}>
      <div className="modal-head"><h2>{dialog === "export" ? tr("Export data", "تصدير البيانات") : dialog === "import" ? tr("Import data", "استيراد البيانات") : tr("Clear data", "مسح البيانات")}</h2><button className="icon-btn" aria-label={tr("Close", "إغلاق")} onClick={close}><X size={18}/></button></div>
      {dialog === "export" && <><label>{tr("Choose what to export", "اختر ما تريد تصديره")}<select aria-label={tr("Export scope", "نطاق التصدير")} value={exportId} onChange={e => setExportId(e.target.value)}><option value="all">{tr("All Projects", "كل المشاريع")}</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><p className="muted">{tr("Downloads projects and tasks from this browser as a versioned JSON backup.", "ينزل المشاريع والمهام من هذا المتصفح كنسخة JSON احتياطية ذات إصدار.")}</p><div className="modal-actions"><button className="ghost" onClick={close}>{tr("Cancel", "إلغاء")}</button><button className="primary" onClick={() => { exportData(exportId === "all" ? undefined : exportId); setDialog(null); }}><Download size={16}/>{tr("Download backup", "تنزيل النسخة")}</button></div></>}
      {dialog === "import" && <><label>{tr("Choose a TaskFlow JSON backup", "اختر نسخة TaskFlow بصيغة JSON")}<input ref={fileRef} type="file" accept=".json,application/json" onChange={e => void pickFile(e.target.files?.[0])}/></label>{notice && <p role="alert" className="data-error">{notice}</p>}{backup && <><div className="import-preview"><strong>{tr("Import preview", "معاينة الاستيراد")}</strong>{backup.projects.map(p => <p key={p.id} dir="auto">{p.name} · {backup.tasks.filter(t => t.projectId === p.id).length} {tr("tasks", "مهام")}</p>)}</div><label className="data-choice"><input type="radio" name="import-mode" checked={mode === "new"} onChange={() => { setMode("new"); setConfirmation(""); }}/>{tr("Import as New", "استيراد كجديد")}</label>{backup.projects.length > 1 && <label>{tr("Project to match for replacement", "المشروع المراد مطابقته للاستبدال")}<select aria-label={tr("Project to match", "المشروع المراد مطابقته")} value={sourceId} onChange={e => { setSourceId(e.target.value); setConfirmation(""); setMode("new"); }}>{backup.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}{canReplace && <><label className="data-choice"><input type="radio" name="import-mode" checked={mode === "replace"} onChange={() => setMode("replace")}/>{tr("Replace Existing", "استبدال الموجود")}</label>{mode === "replace" && <><p className="data-warning">{tr("Only the matching project and its tasks will be replaced. Type REPLACE to confirm.", "سيتم استبدال المشروع المطابق ومهامه فقط. اكتب REPLACE للتأكيد.")}</p><label>{tr("Confirmation", "التأكيد")}<input value={confirmation} onChange={e => setConfirmation(e.target.value)} aria-label="Type REPLACE"/></label></>}</>}</>}
      <div className="modal-actions"><button className="ghost" onClick={close}>{tr("Cancel", "إلغاء")}</button><button className="primary" disabled={!backup || mode === "replace" && (!canReplace || confirmation !== "REPLACE")} onClick={applyImport}>{tr("Import", "استيراد")}</button></div></>}
      {dialog === "clear" && <><p className="data-warning">{tr("This permanently deletes TaskFlow projects, tasks, and related project state from this browser. Type CLEAR to continue.", "سيؤدي هذا إلى حذف مشاريع ومهام TaskFlow وحالة المشاريع المرتبطة بها نهائياً من هذا المتصفح. اكتب CLEAR للمتابعة.")}</p><label>{tr("Confirmation", "التأكيد")}<input autoFocus value={confirmation} onChange={e => setConfirmation(e.currentTarget.value)} onInput={e => setConfirmation(e.currentTarget.value)} onKeyUp={e => setConfirmation(e.currentTarget.value)} aria-label="Type CLEAR"/></label><div className="modal-actions"><button className="ghost" onClick={() => exportData()}><Download size={16}/>{tr("Export Backup", "تصدير نسخة احتياطية")}</button><button className="ghost" onClick={close}>{tr("Cancel", "إلغاء")}</button><button className="danger" disabled={confirmation !== "CLEAR"} onClick={() => { clearWorkspace(); setDialog(null); setConfirmation(""); setNotice(tr("TaskFlow project data cleared.", "تم مسح بيانات مشاريع TaskFlow.")); }}>{tr("Clear data", "مسح البيانات")}</button></div></>}
    </section></div>}
  </div>;
}
