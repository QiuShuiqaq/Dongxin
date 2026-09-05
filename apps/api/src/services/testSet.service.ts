import { randomUUID } from "node:crypto";
import type {
  CreateTestCaseRequest,
  CreateTestSetRequest,
  ImportTestSetMarkdownRequest,
  TestCase,
  TestSet,
  TestSetKind,
  TestSetSummary,
  UpdateTestCaseRequest,
  UpdateTestSetRequest,
} from "@dongxin/shared";
import {
  CreateTestCaseRequestSchema,
  UpdateTestCaseRequestSchema,
} from "@dongxin/shared";
import { ApiError } from "../http/apiError.js";
import * as labDataRepository from "../repositories/labData.repository.js";
import { listTestCases } from "./testCase.service.js";

export const STANDARD_TEST_SET_ID = "standard-test-set";
const STANDARD_TEST_SET_CREATED_AT = "2026-08-17T00:00:00.000Z";

export async function listTestSetSummaries(): Promise<TestSetSummary[]> {
  const [standardSummary, managedSummaries] = await Promise.all([
    buildStandardTestSetSummary(),
    listManagedTestSetSummaries(),
  ]);

  return [standardSummary, ...managedSummaries].sort(compareTestSetSummaries);
}

export async function getTestSet(testSetId: string): Promise<TestSet> {
  if (testSetId === STANDARD_TEST_SET_ID || testSetId === "standard") {
    return buildStandardTestSet();
  }

  const managedTestSets = await labDataRepository.listTestSets();
  const testSet = managedTestSets.find((item) => item.id === testSetId);
  if (!testSet) {
    throw new ApiError(
      404,
      "TEST_SET_NOT_FOUND",
      `Unknown test set: ${testSetId}`,
    );
  }

  return testSet;
}

export async function createTestSet(requestBody: unknown): Promise<TestSet> {
  const body = parseCreateRequest(requestBody);
  const now = new Date().toISOString();
  const managedTestSets = await labDataRepository.listTestSets();
  const testSet = buildTestSetRecord({
    id: buildTestSetId(body.name),
    name: body.name,
    description: body.description,
    kind: body.kind,
    source: "MANUAL",
    isReadOnly: false,
    createdAt: now,
    updatedAt: now,
    cases: [],
  });

  await labDataRepository.saveTestSets([...managedTestSets, testSet]);
  return testSet;
}

export async function importTestSetMarkdown(
  requestBody: unknown,
): Promise<TestSet> {
  const body = parseImportRequest(requestBody);
  const cases = parseMarkdownTestCases(body.markdown);
  if (!cases.length) {
    throw new ApiError(
      422,
      "TEST_SET_IMPORT_EMPTY",
      "Markdown did not contain any test cases",
    );
  }

  const now = new Date().toISOString();
  const managedTestSets = await labDataRepository.listTestSets();
  const testSet = buildTestSetRecord({
    id: buildTestSetId(body.name),
    name: body.name,
    description: body.description,
    kind: body.kind,
    source: "MD_IMPORT",
    isReadOnly: false,
    createdAt: now,
    updatedAt: now,
    cases,
  });

  await labDataRepository.saveTestSets([...managedTestSets, testSet]);
  return testSet;
}

export async function updateTestSet(
  testSetId: string,
  requestBody: unknown,
): Promise<TestSet> {
  if (testSetId === STANDARD_TEST_SET_ID || testSetId === "standard") {
    throw new ApiError(
      422,
      "TEST_SET_READ_ONLY",
      "Standard test set cannot be edited",
    );
  }

  const body = parseUpdateRequest(requestBody);
  const managedTestSets = await labDataRepository.listTestSets();
  const index = managedTestSets.findIndex((item) => item.id === testSetId);
  if (index < 0) {
    throw new ApiError(
      404,
      "TEST_SET_NOT_FOUND",
      `Unknown test set: ${testSetId}`,
    );
  }

  const current = managedTestSets[index];
  const updated: TestSet = buildTestSetRecord({
    ...current,
    name: body.name ?? current.name,
    description: body.description ?? current.description,
    updatedAt: new Date().toISOString(),
  });

  const nextTestSets = [...managedTestSets];
  nextTestSets[index] = updated;
  await labDataRepository.saveTestSets(nextTestSets);
  return updated;
}

export async function deleteTestSet(testSetId: string): Promise<void> {
  if (testSetId === STANDARD_TEST_SET_ID || testSetId === "standard") {
    throw new ApiError(
      422,
      "TEST_SET_READ_ONLY",
      "Standard test set cannot be deleted",
    );
  }

  const managedTestSets = await labDataRepository.listTestSets();
  const nextTestSets = managedTestSets.filter((item) => item.id !== testSetId);
  if (nextTestSets.length === managedTestSets.length) {
    throw new ApiError(
      404,
      "TEST_SET_NOT_FOUND",
      `Unknown test set: ${testSetId}`,
    );
  }

  await labDataRepository.saveTestSets(nextTestSets);
}

export async function addTestCaseToSet(
  testSetId: string,
  requestBody: unknown,
): Promise<TestSet> {
  const body = CreateTestCaseRequestSchema.parse(requestBody);
  const { managedTestSets, index } = await getWritableManagedTestSet(testSetId);
  const current = managedTestSets[index];
  const testCase = normalizeTestCase({
    id: body.id?.trim() || buildTestCaseId(body.category, current.cases.length),
    category: body.category,
    inputText: body.inputText,
    expectedIntent: body.expectedIntent,
    riskLevel: body.riskLevel,
    notes: body.notes,
  });

  if (current.cases.some((item) => item.id === testCase.id)) {
    throw new ApiError(
      409,
      "TEST_CASE_DUPLICATED",
      `Duplicate test case id: ${testCase.id}`,
    );
  }

  const updated = buildTestSetRecord({
    ...current,
    updatedAt: new Date().toISOString(),
    cases: [...current.cases, testCase],
  });
  const nextTestSets = [...managedTestSets];
  nextTestSets[index] = updated;
  await labDataRepository.saveTestSets(nextTestSets);
  return updated;
}

export async function updateTestCaseInSet(
  testSetId: string,
  testCaseId: string,
  requestBody: unknown,
): Promise<TestSet> {
  const body = UpdateTestCaseRequestSchema.parse(requestBody);
  const { managedTestSets, index } = await getWritableManagedTestSet(testSetId);
  const current = managedTestSets[index];
  const caseIndex = current.cases.findIndex((item) => item.id === testCaseId);
  if (caseIndex < 0) {
    throw new ApiError(
      404,
      "TEST_CASE_NOT_FOUND",
      `Unknown test case: ${testCaseId}`,
    );
  }

  const currentCase = current.cases[caseIndex];
  const updatedCase = normalizeTestCase({
    ...currentCase,
    category: body.category ?? currentCase.category,
    inputText: body.inputText ?? currentCase.inputText,
    expectedIntent:
      body.expectedIntent === undefined
        ? currentCase.expectedIntent
        : body.expectedIntent,
    riskLevel: body.riskLevel ?? currentCase.riskLevel,
    notes: body.notes === undefined ? currentCase.notes : body.notes,
  });
  const nextCases = [...current.cases];
  nextCases[caseIndex] = updatedCase;
  const updated = buildTestSetRecord({
    ...current,
    updatedAt: new Date().toISOString(),
    cases: nextCases,
  });
  const nextTestSets = [...managedTestSets];
  nextTestSets[index] = updated;
  await labDataRepository.saveTestSets(nextTestSets);
  return updated;
}

export async function deleteTestCaseFromSet(
  testSetId: string,
  testCaseId: string,
): Promise<TestSet> {
  const { managedTestSets, index } = await getWritableManagedTestSet(testSetId);
  const current = managedTestSets[index];
  const nextCases = current.cases.filter((item) => item.id !== testCaseId);
  if (nextCases.length === current.cases.length) {
    throw new ApiError(
      404,
      "TEST_CASE_NOT_FOUND",
      `Unknown test case: ${testCaseId}`,
    );
  }

  const updated = buildTestSetRecord({
    ...current,
    updatedAt: new Date().toISOString(),
    cases: nextCases,
  });
  const nextTestSets = [...managedTestSets];
  nextTestSets[index] = updated;
  await labDataRepository.saveTestSets(nextTestSets);
  return updated;
}

async function listManagedTestSetSummaries(): Promise<TestSetSummary[]> {
  const managedTestSets = await labDataRepository.listTestSets();
  return managedTestSets.map(toSummary);
}

async function getWritableManagedTestSet(testSetId: string): Promise<{
  managedTestSets: TestSet[];
  index: number;
}> {
  if (testSetId === STANDARD_TEST_SET_ID || testSetId === "standard") {
    throw new ApiError(
      422,
      "TEST_SET_READ_ONLY",
      "Standard test set cannot be edited",
    );
  }

  const managedTestSets = await labDataRepository.listTestSets();
  const index = managedTestSets.findIndex((item) => item.id === testSetId);
  if (index < 0) {
    throw new ApiError(
      404,
      "TEST_SET_NOT_FOUND",
      `Unknown test set: ${testSetId}`,
    );
  }

  return { managedTestSets, index };
}

async function buildStandardTestSetSummary(): Promise<TestSetSummary> {
  const standardTestSet = await buildStandardTestSet();
  return toSummary(standardTestSet);
}

async function buildStandardTestSet(): Promise<TestSet> {
  const cases = await listTestCases();
  return buildTestSetRecord({
    id: STANDARD_TEST_SET_ID,
    name: "标准测试集",
    description: "当前 44 条基准测试语料",
    kind: "STANDARD",
    source: "SYSTEM",
    isReadOnly: true,
    createdAt: STANDARD_TEST_SET_CREATED_AT,
    updatedAt: STANDARD_TEST_SET_CREATED_AT,
    cases,
  });
}

function buildTestSetRecord(input: {
  id: string;
  name: string;
  description: string;
  kind: TestSetKind;
  source: "SYSTEM" | "MANUAL" | "MD_IMPORT";
  isReadOnly: boolean;
  createdAt: string;
  updatedAt: string;
  cases: TestCase[];
}): TestSet {
  const cases = input.cases.map(normalizeTestCase);
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    kind: input.kind,
    source: input.source,
    isReadOnly: input.isReadOnly,
    caseCount: cases.length,
    categoryBreakdown: buildCategoryBreakdown(cases),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    cases,
  };
}

function toSummary(testSet: TestSet): TestSetSummary {
  return {
    id: testSet.id,
    name: testSet.name,
    kind: testSet.kind,
    description: testSet.description,
    source: testSet.source,
    isReadOnly: testSet.isReadOnly,
    caseCount: testSet.caseCount,
    categoryBreakdown: testSet.categoryBreakdown,
    createdAt: testSet.createdAt,
    updatedAt: testSet.updatedAt,
  };
}

function compareTestSetSummaries(
  left: TestSetSummary,
  right: TestSetSummary,
): number {
  const kindOrder = testSetKindOrder(left.kind) - testSetKindOrder(right.kind);
  if (kindOrder !== 0) {
    return kindOrder;
  }

  return right.updatedAt.localeCompare(left.updatedAt);
}

function testSetKindOrder(kind: TestSetKind): number {
  switch (kind) {
    case "STANDARD":
      return 0;
    case "SIMPLE":
      return 1;
    case "COMPLEX":
      return 2;
    case "CUSTOM":
    default:
      return 3;
  }
}

function normalizeTestCase(testCase: TestCase): TestCase {
  return {
    id: testCase.id,
    category: testCase.category.trim(),
    inputText: testCase.inputText.trim(),
    expectedIntent: testCase.expectedIntent,
    riskLevel: testCase.riskLevel,
    notes: testCase.notes?.trim(),
  };
}

function buildCategoryBreakdown(cases: TestCase[]): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const testCase of cases) {
    breakdown[testCase.category] = (breakdown[testCase.category] || 0) + 1;
  }
  return breakdown;
}

function parseCreateRequest(requestBody: unknown): CreateTestSetRequest {
  if (!requestBody || typeof requestBody !== "object") {
    throw new ApiError(422, "INVALID_TEST_SET", "Invalid test set payload");
  }

  const payload = requestBody as Record<string, unknown>;
  return {
    name: readString(payload.name, "Unnamed test set"),
    description: readString(payload.description, ""),
    kind: readKind(payload.kind) || "CUSTOM",
  };
}

function parseUpdateRequest(requestBody: unknown): UpdateTestSetRequest {
  if (!requestBody || typeof requestBody !== "object") {
    throw new ApiError(422, "INVALID_TEST_SET", "Invalid test set payload");
  }

  const payload = requestBody as Record<string, unknown>;
  return {
    name: payload.name === undefined ? undefined : readString(payload.name, ""),
    description:
      payload.description === undefined
        ? undefined
        : readString(payload.description, ""),
  };
}

function parseImportRequest(
  requestBody: unknown,
): ImportTestSetMarkdownRequest {
  if (!requestBody || typeof requestBody !== "object") {
    throw new ApiError(
      422,
      "INVALID_TEST_SET_IMPORT",
      "Invalid markdown import payload",
    );
  }

  const payload = requestBody as Record<string, unknown>;
  const markdown = readString(payload.markdown, "");
  return {
    name: readString(payload.name, "Imported test set"),
    description: readString(payload.description, ""),
    markdown,
    kind: readKind(payload.kind) || "CUSTOM",
  };
}

function parseMarkdownTestCases(markdown: string): TestCase[] {
  const lines = markdown.split(/\r?\n/);
  const testCases: TestCase[] = [];
  let tableHeaders: string[] | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      tableHeaders = null;
      continue;
    }

    if (
      line.startsWith("```") ||
      line.startsWith("#") ||
      line.startsWith(">")
    ) {
      continue;
    }

    if (!line.includes("|")) {
      continue;
    }

    const cells = splitMarkdownRow(line);
    if (cells.length < 2 || isSeparatorRow(cells)) {
      continue;
    }

    if (looksLikeHeaderRow(cells)) {
      tableHeaders = cells.map(normalizeHeader);
      continue;
    }

    const testCase = buildTestCaseFromCells(
      cells,
      tableHeaders,
      testCases.length,
    );
    if (testCase) {
      testCases.push(testCase);
    }
  }

  return testCases;
}

function buildTestCaseFromCells(
  cells: string[],
  headers: string[] | null,
  index: number,
): TestCase | null {
  const values = headers
    ? mapCellsByHeaders(cells, headers)
    : mapCellsByDefaultOrder(cells);
  const category = values.category;
  const inputText = values.inputText;
  if (!category || !inputText) {
    return null;
  }

  const rawTestCase: TestCase = {
    id: values.id || buildTestCaseId(category, index),
    category,
    inputText,
    expectedIntent: parseIntent(values.expectedIntent),
    riskLevel: parseRiskLevel(values.riskLevel),
    notes: values.notes || undefined,
  };

  return normalizeTestCase(rawTestCase);
}

function mapCellsByHeaders(
  cells: string[],
  headers: string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((header, index) => {
    if (index < cells.length) {
      result[header] = cells[index].trim();
    }
  });
  return result;
}

function mapCellsByDefaultOrder(cells: string[]): Record<string, string> {
  return {
    category: cells[0]?.trim() || "",
    inputText: cells[1]?.trim() || "",
    expectedIntent: cells[2]?.trim() || "",
    riskLevel: cells[3]?.trim() || "LOW",
    notes: cells.slice(4).join(" | ").trim(),
  };
}

function splitMarkdownRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((item) => item.trim());
}

function looksLikeHeaderRow(cells: string[]): boolean {
  const joined = cells.map((cell) => normalizeHeader(cell)).join(" ");
  return (
    joined.includes("category") ||
    joined.includes("inputtext") ||
    joined.includes("expectedintent")
  );
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function normalizeHeader(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "");
  switch (normalized) {
    case "id":
    case "案例id":
      return "id";
    case "category":
    case "分类":
    case "类别":
      return "category";
    case "input":
    case "inputtext":
    case "输入":
    case "测试语句":
    case "语句":
      return "inputText";
    case "expectedintent":
    case "intent":
    case "期望意图":
    case "目标意图":
      return "expectedIntent";
    case "risklevel":
    case "风险":
      return "riskLevel";
    case "notes":
    case "备注":
    case "说明":
      return "notes";
    default:
      return normalized;
  }
}

function parseIntent(value: string): TestCase["expectedIntent"] {
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed === "-" ||
    trimmed.toLowerCase() === "null" ||
    trimmed.toLowerCase() === "none"
  ) {
    return null;
  }

  const normalized = trimmed.toUpperCase().replace(/\s+/g, "_");
  const allowed = new Set([
    "LIGHT_ON",
    "LIGHT_OFF",
    "NIGHT_LIGHT_ON",
    "NIGHT_LIGHT_OFF",
    "HEAT_WEAK_ON",
    "HEAT_WEAK_OFF",
    "HEAT_STRONG_ON",
    "HEAT_STRONG_OFF",
    "FAN_ON",
    "FAN_OFF",
    "VENTILATION_ON",
    "VENTILATION_OFF",
    "SWING_ON",
    "SWING_OFF",
    "PURIFY_ON",
    "PURIFY_OFF",
    "DRY_ON",
    "DRY_OFF",
    "DEFOG_ON",
    "DEFOG_OFF",
    "BATH_MODE_ON",
    "BATH_MODE_OFF",
    "CONSTANT_TEMP_ON",
    "CONSTANT_TEMP_OFF",
    "SET_TEMP",
    "VOLUME_UP",
    "VOLUME_DOWN",
    "VOICE_BROADCAST_ON",
    "VOICE_BROADCAST_OFF",
    "STANDBY",
    "SET_TIMER",
  ]);

  return allowed.has(normalized)
    ? (normalized as TestCase["expectedIntent"])
    : null;
}

function parseRiskLevel(value: string): TestCase["riskLevel"] {
  const normalized = value.trim().toUpperCase();
  if (normalized === "MEDIUM" || normalized === "HIGH") {
    return normalized;
  }
  return "LOW";
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readKind(value: unknown): TestSetKind | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  if (
    normalized === "STANDARD" ||
    normalized === "SIMPLE" ||
    normalized === "COMPLEX" ||
    normalized === "CUSTOM"
  ) {
    return normalized;
  }

  return null;
}

function buildTestSetId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "-")
    .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "test-set"}-${randomUUID().slice(0, 8)}`;
}

function buildTestCaseId(category: string, index: number): string {
  const slug = category
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "-")
    .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `case-${slug || "item"}-${String(index + 1).padStart(4, "0")}`;
}
