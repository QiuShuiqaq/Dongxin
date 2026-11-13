import type { CreateTestCaseRequest, TestSet, TestSetSummary, UpdateTestCaseRequest } from "@dongxin/shared";
import { AuthenticationRequiredError } from "./api";

export interface LabScenario {
  id: string;
  title: string;
  category: string;
  summary: string;
}

export interface LabScenarioResult {
  simulation: true;
  deviceId: string;
  scenario: string;
  title: string;
  steps: string[];
  expected: string;
  actionExecuted: false;
  deviceStateChanged: false;
  audioPlayed: false;
  mqttPublished: false;
  note: string;
}

const baseUrl = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? "http://127.0.0.1:3077" : "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = window.sessionStorage.getItem("dongxin-operations-token");
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json() as T & { error?: { message?: string }; message?: string };
  if (!response.ok) {
    if (response.status === 401) throw new AuthenticationRequiredError(payload.error?.message || "请重新登录");
    throw new Error(payload.error?.message || payload.message || `HTTP ${response.status}`);
  }
  return payload;
}

export const getLabScenarios = async () => (await request<{ scenarios: LabScenario[] }>("/api/operations/lab/scenarios")).scenarios;
export const evaluateLabScenario = (scenario: string) => request<LabScenarioResult>("/api/operations/lab/scenarios/evaluate", {
  method: "POST", body: JSON.stringify({ deviceId: "DX-SIM-001", scenario }),
});

export const listLabTestSets = () => request<TestSetSummary[]>("/api/test-sets");
export const getLabTestSet = (id: string) => request<TestSet>(`/api/test-sets/${encodeURIComponent(id)}`);
export const createLabTestSet = (input: { name: string; description: string; kind: "CUSTOM" }) => request<TestSet>("/api/test-sets", {
  method: "POST", body: JSON.stringify(input),
});
export const updateLabTestSet = (id: string, input: { name: string; description: string }) => request<TestSet>(`/api/test-sets/${encodeURIComponent(id)}`, {
  method: "PATCH", body: JSON.stringify(input),
});
export const deleteLabTestSet = (id: string) => request<{ success: true }>(`/api/test-sets/${encodeURIComponent(id)}`, { method: "DELETE" });
export const addLabTestCase = (id: string, input: CreateTestCaseRequest) => request<TestSet>(`/api/test-sets/${encodeURIComponent(id)}/cases`, {
  method: "POST", body: JSON.stringify(input),
});
export const updateLabTestCase = (setId: string, caseId: string, input: UpdateTestCaseRequest) => request<TestSet>(`/api/test-sets/${encodeURIComponent(setId)}/cases/${encodeURIComponent(caseId)}`, {
  method: "PATCH", body: JSON.stringify(input),
});
export const deleteLabTestCase = (setId: string, caseId: string) => request<TestSet>(`/api/test-sets/${encodeURIComponent(setId)}/cases/${encodeURIComponent(caseId)}`, {
  method: "DELETE",
});
