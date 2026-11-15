import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "TaskFlow — Plan beautifully", description: "Your projects, tasks and AI copilot in one focused workspace" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
