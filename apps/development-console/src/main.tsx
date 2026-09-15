import React from "react";
import ReactDOM from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import DevelopmentConsole from "./DevelopmentConsole";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#176b55",
          colorInfo: "#176b55",
          colorSuccess: "#18864b",
          colorWarning: "#b56a08",
          colorError: "#c43d3d",
          borderRadius: 6,
          fontFamily:
            'Inter, "Microsoft YaHei", "Segoe UI", system-ui, sans-serif',
        },
      }}
    >
      <AntApp>
        <DevelopmentConsole />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
