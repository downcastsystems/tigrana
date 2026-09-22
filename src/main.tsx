import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ThemeReferencePage from "./components/ThemeReferencePage";
import AppCrashBoundary from "./components/AppCrashBoundary";
import "./styles/fonts.css";
import "./styles/app.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppCrashBoundary>
      {new URLSearchParams(window.location.search).get("view") === "theme-css-reference" ? <ThemeReferencePage /> : <App />}
    </AppCrashBoundary>
  </React.StrictMode>,
);
