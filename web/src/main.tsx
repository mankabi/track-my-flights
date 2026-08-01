import React from "react";
import ReactDOM from "react-dom/client";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./index.css";
import App from "./App";
import { I18nProvider } from "./i18n";
import { UnitsProvider } from "./lib/units";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <UnitsProvider>
        <App />
      </UnitsProvider>
    </I18nProvider>
  </React.StrictMode>,
);
