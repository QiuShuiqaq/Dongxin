import { Alert, App, Skeleton } from "antd";
import { useEffect, useState } from "react";
import type { OperationsConsoleData } from "./api";
import { getOperationsConsole } from "./api";
import OperationsAiValidation from "./OperationsAiValidation";

export default function LabAiValidation() {
  const { message } = App.useApp();
  const [data, setData] = useState<OperationsConsoleData | null>(null);
  useEffect(() => {
    let active = true;
    void getOperationsConsole("ai").then((result) => { if (active) setData(result); })
      .catch((error) => { if (active) message.error(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, []);
  if (!data) return <Skeleton active paragraph={{ rows: 8 }} />;
  return <div className="lab-workspace">
    <Alert type="info" showIcon title="仅验证文本输入输出，不向设备下发控制" />
    <OperationsAiValidation providers={data.providers} devices={data.devices} canManage />
  </div>;
}
