"use client";

import { createContext, useContext } from "react";

export type UiLanguage = "en" | "ar";
export const UiLanguageContext = createContext<UiLanguage>("en");
export const useUiLanguage = () => useContext(UiLanguageContext);
export const localize = (language: UiLanguage, english: string, arabic: string) => language === "ar" ? arabic : english;
