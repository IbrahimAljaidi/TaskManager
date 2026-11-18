"use client";

import { ArrowRight, CalendarDays, FolderKanban, Plus, Sparkles } from "lucide-react";
import { analytics, type Project, type Task } from "@/lib/domain";
import { deadlineLabel } from "@/lib/deadline";
import { localize, useUiLanguage } from "@/components/UiLanguage";

type Summary = ReturnType<typeof analytics>;

export function EditorialHero({ project, projects, stats, onNewTask, onNewProject, onEditProject }: {
  project?: Project; projects: Project[]; stats: Summary;
  onNewTask: () => void; onNewProject: () => void; onEditProject: () => void;
}) {
  const language = useUiLanguage();
  const t = (en: string, ar: string) => localize(language, en, ar);
  return <section className="editorial-hero" aria-label={t("Workspace overview", "نظرة عامة على مساحة العمل")}>
    <div className="editorial-identity">
      <span className="editorial-index">{t("PROJECT WORKSPACE", "مساحة المشاريع")} <span className="index-rule"/> {project ? "P-" + String(Math.max(1, projects.findIndex(item => item.id === project.id) + 1)).padStart(3, "0") : t("ALL PROJECTS", "كل المشاريع")}</span>
      <h1 className="editorial-wordmark">TaskFlow<span className="wordmark-dot">.</span></h1>
      <div className="orange-swash" aria-hidden="true"/>
      <p className="editorial-deck">{t("Make room for the work that matters.", "مساحة واضحة للعمل الذي يهمك.")}</p>
    </div>
    <div className="editorial-feature">
      <div className="feature-heading"><span className="feature-slash" aria-hidden="true"/><div><span className="eyebrow">{project ? t("ACTIVE PROJECT", "المشروع الحالي") : t("YOUR WORKSPACE", "مساحة عملك")}</span><h2 dir="auto">{project?.name || t("Every project, one clear view", "كل مشاريعك في نظرة واحدة")}</h2></div></div>
      <p className="feature-description" dir="auto">{project?.description || (projects.length ? t("Track progress across your projects and choose where to focus next.", "تابع التقدم في مشاريعك واختر ما تريد التركيز عليه الآن.") : t("Create a project to begin planning your work.", "أنشئ مشروعًا لتبدأ تنظيم عملك."))}</p>
      <div className="feature-progress-label"><span>{t("PROJECT PROGRESS", "تقدم المشروع")}</span><strong>{stats.progress}%</strong></div>
      <div className="editorial-progress" role="progressbar" aria-valuenow={stats.progress} aria-valuemin={0} aria-valuemax={100} aria-label={t("Project completion", "إنجاز المشروع")}><span style={{ width: `${stats.progress}%` }}/></div>
      <div className="feature-counts"><span><i className="count-mark blue"/>{stats.done} {t("Done", "مكتملة")}</span><span><i className="count-mark orange"/>{stats.active} {t("In progress", "قيد التنفيذ")}</span><span><i className="count-mark ink"/>{stats.todo} {t("To do", "للتنفيذ")}</span></div>
      <div className="feature-actions">{project && <button className="primary" onClick={onNewTask}><Plus size={17}/>{t("New task", "مهمة جديدة")}</button>}<button className="ghost" onClick={onNewProject}><Plus size={17}/>{t("Create new", "إنشاء جديد")}</button>{project && <button className="text-btn" onClick={onEditProject}>{t("Edit project", "تعديل المشروع")} <ArrowRight size={15}/></button>}</div>
    </div>
    <div className="hero-art" aria-hidden="true"><div className="art-sun"/><div className="art-arch art-arch-back"/><div className="art-arch art-arch-front"/><div className="art-line art-line-one"/><div className="art-line art-line-two"/></div>
  </section>;
}

export function RealTimeline({ tasks }: { tasks: Task[] }) {
  const language = useUiLanguage();
  const t = (en: string, ar: string) => localize(language, en, ar);
  const dated = [...tasks].filter(task => !!task.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5);
  return <section className="timeline-strip" aria-label={t("Project timeline", "الجدول الزمني للمشروع")}><div className="timeline-label"><CalendarDays size={19}/><strong>{t("Project timeline", "الجدول الزمني")}</strong></div>{dated.length ? <div className="timeline-items">{dated.map(task => <div className="timeline-item" key={task.id}><time dateTime={task.dueTime ? `${task.dueDate}T${task.dueTime}` : task.dueDate}>{deadlineLabel(task)}</time><span dir="auto" title={task.title}>{task.title}</span></div>)}</div> : <p>{t("Add due dates to tasks to build a timeline.", "أضف مواعيد للمهام ليظهر الجدول الزمني.")}</p>}</section>;
}

export function ProjectLibrary({ projects, tasks, selected, onSelect, onNewProject, onPlan }: {
  projects: Project[]; tasks: Task[]; selected: string;
  onSelect: (id: string) => void; onNewProject: () => void; onPlan: () => void;
}) {
  const language = useUiLanguage();
  const t = (en: string, ar: string) => localize(language, en, ar);
  return <section className="library-section"><div className="editorial-section-head"><div><span className="eyebrow">{t("THE DIRECTORY", "دليل المشاريع")}</span><h2>{t("Projects", "المشاريع")}<span className="section-count">{String(projects.length).padStart(2, "0")}</span></h2></div><button className="ghost" onClick={onNewProject}><Plus size={17}/>{t("Add project", "إضافة مشروع")}</button></div>
    {projects.length ? <div className="project-grid">{projects.map((project, index) => { const stat = analytics(tasks.filter(task => task.projectId === project.id)); return <button className={`project-card ${selected === project.id ? "is-current" : ""}`} key={project.id} onClick={() => onSelect(project.id)}><div className="project-card-top"><span>{String(index + 1).padStart(2, "0")} / {t("PROJECT", "مشروع")}</span><FolderKanban size={20}/></div><h3 dir="auto">{project.name}</h3><p dir="auto">{project.description || project.goal || t("Open this project to plan your next steps.", "افتح المشروع لتخطط للخطوات التالية.")}</p><div className="project-card-progress"><span style={{ width: `${stat.progress}%` }}/></div><div className="project-card-bottom"><span>{stat.total} {t("tasks", "مهام")}</span><strong>{stat.progress}% <ArrowRight size={15}/></strong></div></button>; })}</div> : <div className="library-empty"><Sparkles size={31}/><h3>{t("Your next chapter starts here.", "هنا تبدأ خطوتك القادمة.")}</h3><p>{t("Start with a project or ask FlowMate to shape your idea.", "ابدأ بمشروع أو اطلب من FlowMate تنظيم فكرتك.")}</p><div><button className="primary" onClick={onNewProject}>{t("Create project", "إنشاء مشروع")}</button><button className="ghost" onClick={onPlan}>{t("Plan with FlowMate", "التخطيط مع FlowMate")}</button></div></div>}
  </section>;
}

export function PriorityReport({ tasks }: { tasks: Task[] }) {
  const language = useUiLanguage();
  const t = (en: string, ar: string) => localize(language, en, ar);
  const levels = ["urgent", "high", "medium", "low"] as const;
  const counts = levels.map(level => ({ level, value: tasks.filter(task => task.priority === level).length }));
  const max = Math.max(1, ...counts.map(item => item.value));
  return <section className="priority-report"><div className="editorial-section-head"><div><span className="eyebrow">{t("WORKLOAD", "حجم العمل")}</span><h2>{t("Priority distribution", "توزيع الأولويات")}</h2></div></div><div className="priority-rows">{counts.map(item => <div className="priority-row" key={item.level}><span>{t(item.level[0].toUpperCase() + item.level.slice(1), ({ urgent: "عاجلة", high: "مرتفعة", medium: "متوسطة", low: "منخفضة" } as const)[item.level])}</span><div className="priority-track"><i className={`priority-fill ${item.level}`} style={{ width: `${item.value / max * 100}%` }}/></div><strong>{item.value}</strong></div>)}</div><p className="report-note">{tasks.length ? t("Counts are calculated from the tasks currently in view.", "الأعداد محسوبة من مهام العرض الحالي.") : t("Add tasks to see your workload by priority.", "أضف مهامًا لعرض حجم العمل حسب الأولوية.")}</p></section>;
}
