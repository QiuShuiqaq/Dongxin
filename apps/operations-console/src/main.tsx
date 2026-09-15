import React from "react";
import ReactDOM from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import OperationsConsole from "./OperationsConsole";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#235fa4",
          colorInfo: "#235fa4",
          colorSuccess: "#27834b",
          colorWarning: "#ad6c13",
          colorError: "#c23b3b",
          borderRadius: 6,
          fontFamily:
            'Inter, "Microsoft YaHei", "Segoe UI", system-ui, sans-serif',
        },
      }}
    >
      <AntApp><OperationsConsole /></AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
