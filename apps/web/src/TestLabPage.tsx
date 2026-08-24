import {
  DeleteOutlined,
  PlusOutlined,
  ThunderboltOutlined,
  UploadOutlined
} from '@ant-design/icons';
import type {
  EvaluationRun,
  ModelProvider,
  PromptVersion,
  TestSet,
  TestSetKind,
  TestSetSummary
} from '@dongxin/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createTestSet,
  deleteTestSet,
  getTestSet,
  importTestSetMarkdown
} from './api';

const { Text } = Typography;

interface TestLabPageProps {
  providers: ModelProvider[];
  prompts: PromptVersion[];
  testSets: TestSetSummary[];
  evaluations: EvaluationRun[];
  selectedProviderId: string;
  selectedPromptId: string;
  onRunEvaluation: (input: {
    providerIds?: string[];
    testSetId?: string;
    promptId?: string;
    testCaseIds?: string[];
  }) => Promise<EvaluationRun>;
  onRefresh: () => Promise<void>;
}

interface ImportDraft {
  name: string;
  description: string;
  kind: TestSetKind;
  markdown: string;
}

interface EvaluationComparisonRow {
  key: string;
  runId: string;
  providerId: string;
  providerName: string;
  testSetName: string;
  total: number;
  passed: number;
  accuracy: number;
  jsonValidRate: number;
  rejectRate: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCny: number;
  costPerCall: number;
  costPerThousandCalls: number;
  tokensPerCall: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  score: number;
}

interface EvaluationCostRow {
  key: string;
  name: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCny: number;
  costPerCall: number;
  costPerThousandCalls: number;
}

const testSetKindLabels: Record<TestSetKind, string> = {
  STANDARD: '标准',
  SIMPLE: '简单',
  COMPLEX: '复杂',
  CUSTOM: '自定义'
};

const testSetKindOptions = [
  { label: '自定义', value: 'CUSTOM' },
  { label: '简单', value: 'SIMPLE' },
  { label: '复杂', value: 'COMPLEX' }
];

export function TestLabPage(props: TestLabPageProps) {
  const [apiMessageApi, messageHolder] = message.useMessage();
  const [activeTab, setActiveTab] = useState<'sets' | 'comparison' | 'costs'>('sets');
  const [activeTestSetId, setActiveTestSetId] = useState<string>(props.testSets[0]?.id ?? '');
  const [testSetDetail, setTestSetDetail] = useState<TestSet | null>(null);
  const [testSetLoading, setTestSetLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [savingSetId, setSavingSetId] = useState<string | null>(null);
  const [runningEvaluation, setRunningEvaluation] = useState(false);
  const [selectedEvaluationIds, setSelectedEvaluationIds] = useState<string[]>([]);
  const [batchProviderIds, setBatchProviderIds] = useState<string[]>([]);
  const [createForm] = Form.useForm();
  const [importForm] = Form.useForm<ImportDraft>();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!props.testSets.length) {
      setActiveTestSetId('');
      setTestSetDetail(null);
      return;
    }

    if (!props.testSets.some((testSet) => testSet.id === activeTestSetId)) {
      setActiveTestSetId(props.testSets[0].id);
    }
  }, [props.testSets, activeTestSetId]);

  useEffect(() => {
    if (!activeTestSetId) {
      setTestSetDetail(null);
      return;
    }

    let cancelled = false;
    setTestSetLoading(true);
    void getTestSet(activeTestSetId)
      .then((data) => {
        if (!cancelled) {
          setTestSetDetail(data);
          setCategoryFilter('ALL');
        }
      })
      .catch((error) => {
        apiMessageApi.error(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) {
          setTestSetLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTestSetId, apiMessageApi]);

  useEffect(() => {
    if (!props.evaluations.length) {
      setSelectedEvaluationIds([]);
      return;
    }

    setSelectedEvaluationIds((current) => {
      const next = current.filter((id) => props.evaluations.some((evaluation) => evaluation.id === id));
      if (next.length) {
        return next;
      }
      return props.evaluations.slice(0, 3).map((evaluation) => evaluation.id);
    });
  }, [props.evaluations]);

  useEffect(() => {
    if (!props.providers.length) {
      setBatchProviderIds([]);
      return;
    }

    setBatchProviderIds((current) => {
      const validIds = new Set(props.providers.map((provider) => provider.id));
      const next = current.filter((providerId) => validIds.has(providerId));
      if (next.length) {
        return next;
      }

      const enabledIds = props.providers
        .filter((provider) => provider.enabled)
        .slice(0, 4)
        .map((provider) => provider.id);
      if (enabledIds.length) {
        return enabledIds;
      }

      return props.selectedProviderId ? [props.selectedProviderId] : [props.providers[0].id];
    });
  }, [props.providers, props.selectedProviderId]);

  const selectedRunRows = useMemo(
    () => props.evaluations.filter((evaluation) => selectedEvaluationIds.includes(evaluation.id)),
    [props.evaluations, selectedEvaluationIds]
  );
  const comparisonRows = useMemo(() => buildComparisonRows(selectedRunRows), [selectedRunRows]);
  const allComparisonRows = useMemo(() => buildComparisonRows(props.evaluations), [props.evaluations]);
  const providerCostRows = useMemo(() => buildCostRows(allComparisonRows, 'provider'), [allComparisonRows]);
  const testSetCostRows = useMemo(() => buildCostRows(allComparisonRows, 'testSet'), [allComparisonRows]);
  const evaluationCostTotals = useMemo(() => {
    const calls = allComparisonRows.reduce((sum, row) => sum + row.total, 0);
    const costCny = allComparisonRows.reduce((sum, row) => sum + row.costCny, 0);
    return {
      calls,
      costCny,
      inputTokens: allComparisonRows.reduce((sum, row) => sum + row.inputTokens, 0),
      outputTokens: allComparisonRows.reduce((sum, row) => sum + row.outputTokens, 0),
      totalTokens: allComparisonRows.reduce((sum, row) => sum + row.totalTokens, 0),
      costPerCall: calls ? costCny / calls : 0
    };
  }, [allComparisonRows]);
  const activeProvider = props.providers.find((provider) => provider.id === props.selectedProviderId);
  const activePrompt = props.prompts.find((prompt) => prompt.id === props.selectedPromptId);
  const selectedSet = props.testSets.find((testSet) => testSet.id === activeTestSetId);

  const categories = useMemo(() => {
    const source = testSetDetail?.cases ?? [];
    return Array.from(new Set(source.map((item) => item.category))).sort();
  }, [testSetDetail]);
  const visibleCases = useMemo(() => {
    if (!testSetDetail) {
      return [];
    }
    return categoryFilter === 'ALL'
      ? testSetDetail.cases
      : testSetDetail.cases.filter((item) => item.category === categoryFilter);
  }, [categoryFilter, testSetDetail]);

  const testSetColumns: ColumnsType<TestSetSummary> = [
    {
      title: '名称',
      dataIndex: 'name',
      width: 180,
      render: (value, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{value}</Text>
          <Text type="secondary">{record.id}</Text>
        </Space>
      )
    },
    {
      title: '类型',
      dataIndex: 'kind',
      width: 100,
      render: (value: TestSetKind) => <Tag color={kindColor(value)}>{testSetKindLabels[value]}</Tag>
    },
    { title: '数量', dataIndex: 'caseCount', width: 90 },
    {
      title: '来源',
      dataIndex: 'source',
      width: 100,
      render: (value) => <Tag>{value}</Tag>
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 180
    },
    {
      title: '操作',
      width: 120,
      render: (_, record) => (
        <Popconfirm
          title="删除测试集"
          description={record.isReadOnly ? '标准测试集不能删除' : '删除后不可恢复'}
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => void handleDeleteTestSet(record)}
        >
          <Button size="small" danger icon={<DeleteOutlined />} disabled={record.isReadOnly} />
        </Popconfirm>
      )
    }
  ];

  const evaluationColumns: ColumnsType<EvaluationRun> = [
    {
      title: '测试集',
      dataIndex: 'testSetName',
      width: 180,
      render: (value, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{value}</Text>
          <Text type="secondary">{record.testSetId}</Text>
        </Space>
      )
    },
    {
      title: '模型',
      width: 180,
      render: (_, record) => record.summary.providerSummaries.map((item) => item.providerName).join(' / ')
    },
    {
      title: '准确率',
      width: 100,
      render: (_, record) => renderRate(record.summary.passed, record.summary.total)
    },
    {
      title: 'JSON有效率',
      width: 110,
      render: (_, record) => renderRate(record.summary.jsonValid, record.summary.total)
    },
    {
      title: '平均延迟',
      width: 110,
      render: (_, record) => `${record.summary.averageLatencyMs} ms`
    },
    {
      title: 'P95',
      width: 100,
      render: (_, record) => `${record.summary.p95LatencyMs} ms`
    },
    {
      title: '费用',
      width: 100,
      render: (_, record) => formatCny(record.summary.costCny)
    },
    {
      title: 'Token',
      width: 100,
      render: (_, record) => record.summary.totalTokens
    }
  ];

  const selectedEvaluationColumns: ColumnsType<EvaluationComparisonRow> = [
    {
      title: '模型',
      width: 180,
      dataIndex: 'providerName'
    },
    {
      title: '测试集',
      dataIndex: 'testSetName',
      width: 180
    },
    {
      title: '准确率',
      width: 100,
      render: (_, record) => formatPercent(record.accuracy)
    },
    {
      title: 'JSON有效率',
      width: 120,
      render: (_, record) => formatPercent(record.jsonValidRate)
    },
    {
      title: '综合分',
      width: 100,
      render: (_, record) => record.score.toFixed(1)
    },
    {
      title: '成本/次',
      width: 120,
      render: (_, record) => formatCny(record.costPerCall)
    },
    {
      title: '千次成本',
      width: 120,
      render: (_, record) => formatCny(record.costPerThousandCalls)
    },
    {
      title: 'Token/次',
      width: 100,
      render: (_, record) => Math.round(record.tokensPerCall)
    },
    {
      title: '平均延迟',
      width: 110,
      render: (_, record) => `${record.averageLatencyMs} ms`
    },
    {
      title: 'P95',
      width: 100,
      render: (_, record) => `${record.p95LatencyMs} ms`
    }
  ];

  const costColumns: ColumnsType<EvaluationCostRow> = [
    { title: '名称', dataIndex: 'name', width: 220 },
    { title: '调用次数', dataIndex: 'calls', width: 110 },
    { title: '输入 Token', dataIndex: 'inputTokens', width: 130 },
    { title: '输出 Token', dataIndex: 'outputTokens', width: 130 },
    { title: '总 Token', dataIndex: 'totalTokens', width: 130 },
    { title: '总费用', dataIndex: 'costCny', width: 120, render: (value) => formatCny(value) },
    { title: '成本/次', dataIndex: 'costPerCall', width: 120, render: (value) => formatCny(value) },
    { title: '千次成本', dataIndex: 'costPerThousandCalls', width: 120, render: (value) => formatCny(value) }
  ];

  async function handleCreateTestSet(values: { name: string; description?: string; kind?: TestSetKind }) {
    setSavingSetId('create');
    try {
      await createTestSet({
        name: values.name.trim(),
        description: values.description?.trim() || '',
        kind: values.kind || 'CUSTOM'
      });
      apiMessageApi.success('测试集已创建');
      setCreatingOpen(false);
      createForm.resetFields();
      await props.onRefresh();
    } catch (error) {
      apiMessageApi.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingSetId(null);
    }
  }

  async function handleDeleteTestSet(testSet: TestSetSummary) {
    if (testSet.isReadOnly) {
      apiMessageApi.warning('标准测试集不能删除');
      return;
    }

    setSavingSetId(testSet.id);
    try {
      await deleteTestSet(testSet.id);
      apiMessageApi.success('测试集已删除');
      await props.onRefresh();
      if (activeTestSetId === testSet.id) {
        setActiveTestSetId(props.testSets.find((item) => item.id !== testSet.id)?.id ?? '');
      }
    } catch (error) {
      apiMessageApi.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingSetId(null);
    }
  }

  async function handleImportMarkdown(values: ImportDraft) {
    setSavingSetId('import');
    try {
      await importTestSetMarkdown({
        name: values.name.trim(),
        description: values.description.trim(),
        kind: values.kind,
        markdown: values.markdown
      });
      apiMessageApi.success('Markdown 已导入为测试集');
      setImportOpen(false);
      importForm.resetFields();
      await props.onRefresh();
    } catch (error) {
      apiMessageApi.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingSetId(null);
    }
  }

  async function handleRunSelectedSet(testCaseIds?: string[]) {
    if (!activeTestSetId) {
      apiMessageApi.warning('请先选择测试集');
      return;
    }

    if (!batchProviderIds.length) {
      apiMessageApi.warning('请先选择至少一个模型');
      return;
    }

    try {
      setRunningEvaluation(true);
      const run = await props.onRunEvaluation({
        providerIds: batchProviderIds,
        promptId: props.selectedPromptId,
        testSetId: activeTestSetId,
        testCaseIds
      });
      apiMessageApi.success(`评测完成：${run.summary.passed}/${run.summary.total}`);
      setSelectedEvaluationIds((current) => [run.id, ...current.filter((id) => id !== run.id)]);
      await props.onRefresh();
    } catch (error) {
      apiMessageApi.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRunningEvaluation(false);
    }
  }

  function handlePickMarkdownFile(file: File) {
    void file.text().then((markdown) => {
      importForm.setFieldsValue({
        name: file.name.replace(/\.md$/i, ''),
        description: '',
        kind: 'CUSTOM',
        markdown
      });
      setImportOpen(true);
    });
    return false;
  }

  return (
    <Space orientation="vertical" size={16} className="full-width test-lab">
      {messageHolder}
      <Card size="small">
        <Row gutter={[16, 16]}>
          <Col xs={24} md={6}>
            <Statistic title="测试集" value={props.testSets.length} prefix={<Badge status="processing" />} />
          </Col>
          <Col xs={24} md={6}>
            <Statistic
              title="总语料"
              value={props.testSets.reduce((sum, testSet) => sum + testSet.caseCount, 0)}
              prefix={<Badge status="success" />}
            />
          </Col>
          <Col xs={24} md={6}>
            <Statistic title="评测记录" value={props.evaluations.length} prefix={<Badge status="default" />} />
          </Col>
          <Col xs={24} md={6}>
            <Statistic title="当前模型" value={activeProvider?.name || '-'} />
          </Col>
        </Row>
      </Card>

      <div className="inline-note">
        <Badge status="processing" />
        <Text type="secondary">评测会记录准确率、JSON有效率、延迟、成本和 Token；勾选多次结果后自动生成对比。</Text>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={(value) => setActiveTab(value as 'sets' | 'comparison' | 'costs')}
        items={[
          {
            key: 'sets',
            label: '测试集管理',
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24} xl={10}>
                  <Card
                    size="small"
                    title="测试集列表"
                    extra={
                      <Space>
                        <Button icon={<PlusOutlined />} onClick={() => setCreatingOpen(true)}>
                          新建
                        </Button>
                        <Button icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()}>
                          导入 .md
                        </Button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".md,text/markdown"
                          hidden
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) {
                              handlePickMarkdownFile(file);
                            }
                            event.target.value = '';
                          }}
                        />
                      </Space>
                    }
                  >
                    <Table
                      rowKey="id"
                      size="small"
                      columns={testSetColumns}
                      dataSource={props.testSets}
                      pagination={false}
                      onRow={(record) => ({
                        onClick: () => setActiveTestSetId(record.id)
                      })}
                      rowClassName={(record) => (record.id === activeTestSetId ? 'row-selected' : '')}
                    />
                  </Card>
                </Col>

                <Col xs={24} xl={14}>
                  <Card
                    size="small"
                    title={selectedSet?.name || '测试集详情'}
                    extra={
                      <Space wrap>
                        <Select
                          mode="multiple"
                          maxTagCount="responsive"
                          value={batchProviderIds}
                          onChange={setBatchProviderIds}
                          style={{ minWidth: 280 }}
                          placeholder="选择批量评测模型"
                          options={props.providers.map((provider) => ({
                            label: provider.name,
                            value: provider.id
                          }))}
                        />
                        <Popconfirm
                          title="确认开始批量评测"
                          description={`将调用 ${batchProviderIds.length} 个模型 × ${testSetDetail?.caseCount ?? 0} 条语料。`}
                          okText="开始"
                          cancelText="取消"
                          onConfirm={() => void handleRunSelectedSet()}
                        >
                          <Button
                            type="primary"
                            icon={<ThunderboltOutlined />}
                            loading={runningEvaluation}
                            disabled={!testSetDetail || !batchProviderIds.length}
                          >
                            运行全量
                          </Button>
                        </Popconfirm>
                      </Space>
                    }
                  >
                    {testSetLoading || !testSetDetail ? (
                      <Alert type="info" showIcon message="请选择一个测试集查看详情" />
                    ) : (
                      <Space orientation="vertical" size={16} className="full-width">
                        <Descriptions size="small" column={{ xs: 1, md: 3 }}>
                          <Descriptions.Item label="类型">
                            <Tag color={kindColor(testSetDetail.kind)}>{testSetKindLabels[testSetDetail.kind]}</Tag>
                          </Descriptions.Item>
                          <Descriptions.Item label="来源">{testSetDetail.source}</Descriptions.Item>
                          <Descriptions.Item label="题量">{testSetDetail.caseCount}</Descriptions.Item>
                        </Descriptions>
                        <Space wrap>
                          {Object.entries(testSetDetail.categoryBreakdown).map(([category, count]) => (
                            <Tag key={category}>
                              {category} {count}
                            </Tag>
                          ))}
                        </Space>
                        <Divider className="compact-divider" />
                        <Space style={{ width: '100%' }} wrap>
                          <Select
                            value={categoryFilter}
                            onChange={setCategoryFilter}
                            style={{ width: 200 }}
                            options={[
                              { label: '全部类别', value: 'ALL' },
                              ...categories.map((item) => ({ label: item, value: item }))
                            ]}
                          />
                          <Text type="secondary">当前筛选 {visibleCases.length}/{testSetDetail.cases.length}</Text>
                          <Popconfirm
                            title="确认运行当前筛选"
                            description={`将调用 ${batchProviderIds.length} 个模型 × ${visibleCases.length} 条语料。`}
                            okText="开始"
                            cancelText="取消"
                            onConfirm={() => void handleRunSelectedSet(visibleCases.map((item) => item.id))}
                          >
                            <Button
                              icon={<ThunderboltOutlined />}
                              loading={runningEvaluation}
                              disabled={!visibleCases.length || visibleCases.length === testSetDetail.cases.length}
                            >
                              运行筛选
                            </Button>
                          </Popconfirm>
                        </Space>
                        <Table
                          rowKey="id"
                          size="small"
                          columns={[
                            { title: '类别', dataIndex: 'category', width: 120 },
                            { title: '语句', dataIndex: 'inputText', ellipsis: true },
                            { title: '期望', dataIndex: 'expectedIntent', width: 160, render: (value) => value || '无' },
                            { title: '风险', dataIndex: 'riskLevel', width: 90 },
                            { title: '备注', dataIndex: 'notes', ellipsis: true }
                          ]}
                          dataSource={visibleCases}
                          pagination={{ pageSize: 10 }}
                        />
                      </Space>
                    )}
                  </Card>
                </Col>
              </Row>
            )
          },
          {
            key: 'comparison',
            label: '评测对比',
            children: (
              <Space orientation="vertical" size={16} className="full-width">
                <Card size="small" title="当前配置">
                  <Descriptions size="small" column={{ xs: 1, md: 3 }}>
                    <Descriptions.Item label="模型">
                      {activeProvider?.name || props.selectedProviderId || '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="Prompt">{activePrompt?.name || props.selectedPromptId || '-'}</Descriptions.Item>
                    <Descriptions.Item label="测试集">{selectedSet?.name || '-'}</Descriptions.Item>
                  </Descriptions>
                </Card>

                <Card size="small" title="评测记录">
                  <Table
                    rowKey="id"
                    size="small"
                    columns={evaluationColumns}
                    dataSource={props.evaluations}
                    pagination={{ pageSize: 8 }}
                    rowSelection={{
                      selectedRowKeys: selectedEvaluationIds,
                      onChange: (keys) => setSelectedEvaluationIds(keys as string[])
                    }}
                    rowClassName={(record) => (selectedEvaluationIds.includes(record.id) ? 'row-selected' : '')}
                  />
                </Card>

                <div className="comparison-metrics-strip">
                  <MetricChart
                    title="综合分"
                    items={comparisonRows.map((row) => ({
                      label: buildComparisonLabel(row),
                      value: row.score,
                      suffix: '分',
                      color: '#1677ff',
                      displayValue: row.score.toFixed(1)
                    }))}
                  />
                  <MetricChart
                    title="准确率"
                    items={comparisonRows.map((row) => ({
                      label: buildComparisonLabel(row),
                      value: row.accuracy,
                      suffix: '%',
                      color: '#4f8fd8',
                      displayValue: formatPercent(row.accuracy)
                    }))}
                  />
                  <MetricChart
                    title="平均延迟"
                    items={comparisonRows.map((row) => ({
                      label: buildComparisonLabel(row),
                      value: row.averageLatencyMs,
                      suffix: 'ms',
                      color: '#5ca6a8',
                      displayValue: `${row.averageLatencyMs} ms`
                    }))}
                  />
                  <MetricChart
                    title="每次成本"
                    items={comparisonRows.map((row) => ({
                      label: buildComparisonLabel(row),
                      value: row.costPerCall,
                      suffix: '元',
                      color: '#d99245',
                      displayValue: formatCny(row.costPerCall)
                    }))}
                  />
                  <MetricChart
                    title="Token / 次"
                    items={comparisonRows.map((row) => ({
                      label: buildComparisonLabel(row),
                      value: row.tokensPerCall,
                      suffix: 'token',
                      color: '#7b6fb0',
                      displayValue: `${Math.round(row.tokensPerCall)}`
                    }))}
                  />
                </div>

                <Card size="small" title="口径建议">
                  <Descriptions size="small" column={{ xs: 1, md: 2 }}>
                    <Descriptions.Item label="准确率">通过数 / 总数</Descriptions.Item>
                    <Descriptions.Item label="JSON有效率">可解析结果 / 总数</Descriptions.Item>
                    <Descriptions.Item label="平均成本">总成本 / 调用次数</Descriptions.Item>
                    <Descriptions.Item label="每千次成本">平均成本 × 1000</Descriptions.Item>
                    <Descriptions.Item label="P95延迟">按单次延迟排序后的第95分位</Descriptions.Item>
                    <Descriptions.Item label="综合评分">
                      0.45 × 准确率 + 0.15 × JSON有效率 + 0.15 × P95延迟得分 + 0.15 × 成本得分 + 0.10 × 非拒绝率
                    </Descriptions.Item>
                  </Descriptions>
                </Card>

                <Card size="small" title="选中结果">
                  <Table
                    rowKey="key"
                    size="small"
                    columns={selectedEvaluationColumns}
                    dataSource={comparisonRows}
                    pagination={false}
                    locale={{ emptyText: '先在上面的评测记录里勾选几条结果' }}
                  />
                </Card>
              </Space>
            )
          },
          {
            key: 'costs',
            label: '测试费用',
            children: (
              <Space orientation="vertical" size={16} className="full-width">
                <Alert
                  type="info"
                  showIcon
                  message="这里只统计意图测试产生的评测费用"
                  description="生产环境真实设备调用费用在左侧“费用统计”中查看，两边数据口径分开。"
                />
                <Row gutter={[16, 16]}>
                  <Col xs={24} md={12} xl={6}>
                    <Card size="small">
                      <Statistic title="测试调用" value={evaluationCostTotals.calls} suffix="次" />
                    </Card>
                  </Col>
                  <Col xs={24} md={12} xl={6}>
                    <Card size="small">
                      <Statistic title="测试费用" value={evaluationCostTotals.costCny} precision={6} prefix="￥" />
                    </Card>
                  </Col>
                  <Col xs={24} md={12} xl={6}>
                    <Card size="small">
                      <Statistic title="单次均价" value={evaluationCostTotals.costPerCall} precision={6} prefix="￥" />
                    </Card>
                  </Col>
                  <Col xs={24} md={12} xl={6}>
                    <Card size="small">
                      <Statistic title="总 Token" value={evaluationCostTotals.totalTokens} />
                    </Card>
                  </Col>
                </Row>
                <Card size="small" title="按模型统计">
                  <Table
                    rowKey="key"
                    size="small"
                    columns={costColumns}
                    dataSource={providerCostRows}
                    pagination={false}
                    locale={{ emptyText: '暂无测试费用数据' }}
                  />
                </Card>
                <Card size="small" title="按测试集统计">
                  <Table
                    rowKey="key"
                    size="small"
                    columns={costColumns}
                    dataSource={testSetCostRows}
                    pagination={false}
                    locale={{ emptyText: '暂无测试费用数据' }}
                  />
                </Card>
                <Card size="small" title="Token 汇总">
                  <Descriptions size="small" column={{ xs: 1, md: 3 }}>
                    <Descriptions.Item label="输入 Token">{evaluationCostTotals.inputTokens}</Descriptions.Item>
                    <Descriptions.Item label="输出 Token">{evaluationCostTotals.outputTokens}</Descriptions.Item>
                    <Descriptions.Item label="费用来源">EvaluationRun.summary</Descriptions.Item>
                  </Descriptions>
                </Card>
              </Space>
            )
          }
        ]}
      />

      <Modal
        title="新建测试集"
        open={creatingOpen}
        confirmLoading={savingSetId === 'create'}
        okText="创建"
        cancelText="取消"
        onOk={() => void createForm.submit()}
        onCancel={() => setCreatingOpen(false)}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" onFinish={(values) => void handleCreateTestSet(values)}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="例如：售后快速测试集" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={3} placeholder="可选" />
          </Form.Item>
          <Form.Item name="kind" label="类型" initialValue="CUSTOM">
            <Select options={testSetKindOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="导入 Markdown 测试集"
        open={importOpen}
        width={900}
        confirmLoading={savingSetId === 'import'}
        okText="导入"
        cancelText="取消"
        onOk={() => void importForm.submit()}
        onCancel={() => setImportOpen(false)}
        destroyOnClose
      >
        <Form form={importForm} layout="vertical" onFinish={(values) => void handleImportMarkdown(values)}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="kind" label="类型" initialValue="CUSTOM">
            <Select options={testSetKindOptions} />
          </Form.Item>
          <Form.Item name="markdown" label="Markdown 内容" rules={[{ required: true, message: '请粘贴 Markdown 内容' }]}>
            <Input.TextArea rows={16} placeholder="支持 markdown 表格或按列排列的语料行" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

function MetricChart(props: {
  title: string;
  items: Array<{
    label: string;
    value: number;
    suffix: string;
    color: string;
    displayValue: string;
  }>;
}) {
  const maxValue = Math.max(...props.items.map((item) => item.value), 1);

  return (
    <Card size="small" title={props.title}>
      {props.items.length ? (
        <div className="metric-list">
          {props.items.map((item) => (
            <div key={item.label} className="metric-row">
              <div className="metric-row-main">
                <Text className="metric-row-label" title={item.label}>
                  {item.label}
                </Text>
                <Text strong>{item.displayValue}</Text>
              </div>
              <div className="metric-row-track">
                <div
                  className="metric-row-bar"
                  style={{
                    width: `${Math.max(4, (item.value / maxValue) * 100)}%`,
                    background: item.color
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Alert type="info" showIcon message="先选择几条评测结果，再看对比图。" />
      )}
    </Card>
  );
}

function buildComparisonRows(runs: EvaluationRun[]): EvaluationComparisonRow[] {
  const rows = runs.flatMap((run) =>
    run.summary.providerSummaries.map((summary) => {
      const total = summary.total || 0;
      return {
        key: `${run.id}:${summary.providerId}`,
        runId: run.id,
        providerId: summary.providerId,
        providerName: summary.providerName,
        testSetName: run.testSetName,
        total,
        passed: summary.passed,
        accuracy: total ? summary.passed / total : 0,
        jsonValidRate: total ? summary.jsonValid / total : 0,
        rejectRate: total ? summary.rejectCount / total : 0,
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        totalTokens: summary.totalTokens,
        costCny: summary.costCny,
        costPerCall: total ? summary.costCny / total : 0,
        costPerThousandCalls: total ? (summary.costCny / total) * 1000 : 0,
        tokensPerCall: total ? summary.totalTokens / total : 0,
        averageLatencyMs: summary.averageLatencyMs,
        p95LatencyMs: summary.p95LatencyMs,
        score: 0
      };
    })
  );

  const costValues = rows.map((row) => row.costPerCall);
  const latencyValues = rows.map((row) => row.p95LatencyMs);
  return rows.map((row) => {
    const latencyScore = lowerIsBetterScore(row.p95LatencyMs, latencyValues);
    const costScore = lowerIsBetterScore(row.costPerCall, costValues);
    const nonRejectRate = 1 - row.rejectRate;
    const score =
      (row.accuracy * 0.45 +
        row.jsonValidRate * 0.15 +
        latencyScore * 0.15 +
        costScore * 0.15 +
        nonRejectRate * 0.1) *
      100;

    return {
      ...row,
      score: Math.round(score * 10) / 10
    };
  }).sort((left, right) => right.score - left.score || left.providerName.localeCompare(right.providerName));
}

function buildCostRows(rows: EvaluationComparisonRow[], groupBy: 'provider' | 'testSet'): EvaluationCostRow[] {
  const groups = new Map<string, EvaluationCostRow>();

  for (const row of rows) {
    const key = groupBy === 'provider' ? row.providerId : row.testSetName;
    const name = groupBy === 'provider' ? row.providerName : row.testSetName;
    const current =
      groups.get(key) ??
      {
        key,
        name,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costCny: 0,
        costPerCall: 0,
        costPerThousandCalls: 0
      };

    current.calls += row.total;
    current.inputTokens += row.inputTokens;
    current.outputTokens += row.outputTokens;
    current.totalTokens += row.totalTokens;
    current.costCny += row.costCny;
    current.costPerCall = current.calls ? current.costCny / current.calls : 0;
    current.costPerThousandCalls = current.costPerCall * 1000;
    groups.set(key, current);
  }

  return Array.from(groups.values()).sort((left, right) => right.costCny - left.costCny);
}

function lowerIsBetterScore(value: number, values: number[]): number {
  const finiteValues = values.filter((item) => Number.isFinite(item));
  if (!finiteValues.length) {
    return 0;
  }

  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  if (max === min) {
    return 1;
  }

  return Math.max(0, Math.min(1, 1 - (value - min) / (max - min)));
}

function renderRate(passed: number, total: number): string {
  if (!total) {
    return '0%';
  }
  return `${Math.round((passed / total) * 100)}%`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function buildComparisonLabel(row: EvaluationComparisonRow): string {
  return `${row.providerName} · ${row.testSetName}`;
}

function formatCny(value: number): string {
  return `￥${value.toFixed(6)}`;
}

function kindColor(kind: TestSetKind): string {
  switch (kind) {
    case 'STANDARD':
      return 'blue';
    case 'SIMPLE':
      return 'green';
    case 'COMPLEX':
      return 'orange';
    case 'CUSTOM':
    default:
      return 'default';
  }
}
