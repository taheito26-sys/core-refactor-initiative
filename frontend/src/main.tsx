import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const BUILD_STORAGE_KEY = "__app_build_id__";
const BUILD_RELOAD_GUARD_KEY = "__app_build_reload_guard__";
const APP_BUILD_ID = __APP_BUILD_ID__;

async function applyBuildDriftRecovery(): Promise<boolean> {
  if (typeof window === "undefined") return true;

  const previousBuildId = localStorage.getItem(BUILD_STORAGE_KEY);
  const reloadGuard = sessionStorage.getItem(BUILD_RELOAD_GUARD_KEY);
  const hasDrift = previousBuildId && previousBuildId !== APP_BUILD_ID;

  if (hasDrift && reloadGuard !== APP_BUILD_ID) {
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((reg) => reg.unregister()));
      }
      if ("caches" in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      }
    } catch {
      // Best effort cache drift recovery
    }

    sessionStorage.setItem(BUILD_RELOAD_GUARD_KEY, APP_BUILD_ID);
    localStorage.setItem(BUILD_STORAGE_KEY, APP_BUILD_ID);
    window.location.reload();
    return false;
  }

  localStorage.setItem(BUILD_STORAGE_KEY, APP_BUILD_ID);
  sessionStorage.removeItem(BUILD_RELOAD_GUARD_KEY);
  console.info(`[build] ${APP_BUILD_ID}`);
  return true;
}

const root = document.getElementById("root");
if (root) {
  void applyBuildDriftRecovery().then((shouldRender) => {
    if (!shouldRender) return;
    createRoot(root).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
}
