import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// the app shell offline and "add to home screen"; the API is never cached
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"));
}
