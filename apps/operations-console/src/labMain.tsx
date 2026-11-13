import React from "react";
import ReactDOM from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import LabConsole from "./LabConsole";
import "./styles.css";
import "./lab.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#16756a",
          colorInfo: "#16756a",
          colorSuccess: "#27834b",
          colorWarning: "#ad6c13",
          colorError: "#c23b3b",
          borderRadius: 5,
          fontFamily: 'Inter, "Microsoft YaHei", "Segoe UI", system-ui, sans-serif',
        },
      }}
    >
      <AntApp><LabConsole /></AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
