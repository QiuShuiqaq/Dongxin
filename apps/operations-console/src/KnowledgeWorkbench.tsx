import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Drawer, Empty, Form, Input, Modal, Popconfirm, Select, Space, Table, Tabs, Tag } from 'antd';
import { PlusOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import type { CreateKnowledgeDocumentRequest, KnowledgeDocument, KnowledgeScope, KnowledgeSource, KnowledgeQueryResponse } from '@dongxin/shared';
import { createKnowledgeDocument, downloadKnowledgeSource, getKnowledgeHistory, getKnowledgePage, getKnowledgeSources, importKnowledgeSections, previewKnowledgeSource,
  queryKnowledge, updateKnowledgeDocument, uploadKnowledgeSource } from './api';
import type { KnowledgeHistory, KnowledgePage, OperationsUser, SourcePreview, SourceSection } from './api';

const scopeNames = { COMPANY: '企业背景', GENERAL: '浴霸通用知识', MODEL: '指定型号', REFERENCE: '内部参考' };
const statusNames = { DRAFT: '草稿', IN_REVIEW: '待审核', PUBLISHED: '已发布', ARCHIVED: '已停用' };
const statusColors = { DRAFT: 'default', IN_REVIEW: 'orange', PUBLISHED: 'green', ARCHIVED: 'default' };
const categoryNames = { PRODUCT: '产品资料', INSTALL: '安装说明', USAGE: '使用说明', TROUBLESHOOTING: '故障处理', AFTER_SALES: '售后规则', MAINTENANCE: '保养清洁', OTHER: '企业与其他' };
const processingNames = { EXTRACTED: '已提取文字', NEEDS_OCR: '待 OCR 校对', CATALOGUED: '已登记，未整理', DUPLICATE: '重复资料' };
const actionNames: Record<string, string> = { CREATE: '新增草稿', IMPORT: '章节导入', SAVE: '保存', SUBMIT: '提交审核', PUBLISH: '审核发布', REJECT: '退回修改', ARCHIVE: '停用', RESTORE: '恢复为草稿' };
const options = (names: Record<string, string>) => Object.entries(names).map(([value, label]) => ({ value, label }));
const date = (value?: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';

export default function KnowledgeWorkbench({ user, refreshKey = 0 }: { user: OperationsUser | null; refreshKey?: number }) {
  const { message } = App.useApp();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'EDITOR';
  const canReview = user?.role === 'ADMIN' || user?.role === 'REVIEWER';
  const [tab, setTab] = useState('entries');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [data, setData] = useState<KnowledgePage>();
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [editor, setEditor] = useState<Partial<KnowledgeDocument> | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<SourcePreview>();
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [importModels, setImportModels] = useState<string[]>([]);
  const [history, setHistory] = useState<KnowledgeHistory>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTitle, setHistoryTitle] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [rejecting, setRejecting] = useState<KnowledgeDocument>();
  const [rejectReason, setRejectReason] = useState('');
  const [form] = Form.useForm<CreateKnowledgeDocumentRequest>();
  const selectedScope = Form.useWatch('scope', form);
  const requestId = useRef(0);
  const report = (error: unknown) => message.error(error instanceof Error ? error.message : String(error));

  useEffect(() => {
    let active = true;
    void getKnowledgeSources().then((items) => { if (active) setSources(items); }).catch(report);
    return () => { active = false; };
  }, [refresh, refreshKey]);
  useEffect(() => {
    const id = ++requestId.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      const query = { page: String(page), pageSize: String(pageSize), search, ...(scope ? { scope } : {}),
        ...(tab === 'review' ? { status: 'IN_REVIEW' } : status ? { status } : {}) };
      void getKnowledgePage(query).then((value) => { if (id === requestId.current) setData(value); })
        .catch((error) => { if (id === requestId.current) report(error); })
        .finally(() => { if (id === requestId.current) setLoading(false); });
    }, 180);
    return () => { window.clearTimeout(timer); requestId.current++; };
  }, [page, pageSize, search, scope, status, tab, refresh, refreshKey]);
  useEffect(() => { setSelectedIds([]); }, [page, pageSize, search, scope, status, tab, refresh, refreshKey]);
  useEffect(() => {
    setSectionIds((preview?.sections ?? []).slice(0, 200).map((section) => section.id));
    setImportModels([]);
  }, [preview]);

  function edit(document: Partial<KnowledgeDocument> = {}) {
    setEditor(document);
    form.setFieldsValue({ title: '', category: 'OTHER', content: '', tags: [], scope: 'GENERAL', modelIds: [], questionVariants: [], sourceId: null, sourceLocation: '', ...document });
  }
  async function save() {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editor?.id) await updateKnowledgeDocument(editor.id, { ...values, action: 'SAVE', expectedVersion: editor.version ?? 1 });
      else await createKnowledgeDocument(values);
      setEditor(null); setRefresh((value) => value + 1);
      message.success(editor?.status === 'PUBLISHED' ? '新版已保存为草稿，原发布版本继续生效' : '草稿已保存');
    } catch (error) { if (!(error && typeof error === 'object' && 'errorFields' in error)) report(error); }
    finally { setSaving(false); }
  }
  async function action(document: KnowledgeDocument, action: string, reason = '') {
    setBusy(true);
    try {
      await updateKnowledgeDocument(document.id, { action, reason, expectedVersion: document.version ?? 1 });
      message.success(`${actionNames[action]}完成`); setRefresh((value) => value + 1); setRejecting(undefined);
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  async function showHistory(document: KnowledgeDocument) {
    setHistory(undefined); setHistoryTitle(document.title); setHistoryOpen(true); setHistoryLoading(true);
    try { setHistory(await getKnowledgeHistory(document.id)); } catch (error) { report(error); }
    finally { setHistoryLoading(false); }
  }
  async function showSource(source: KnowledgeSource) {
    setBusy(true);
    try { setPreview(await previewKnowledgeSource(source.id)); } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  async function importSections() {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await importKnowledgeSections(preview.source.id, { extractionHash: preview.extractionHash, sectionIds, modelIds: importModels });
      message.success(`新增 ${result.created} 条草稿，跳过 ${result.skipped} 条已整理内容`);
      setPreview(undefined); setTab('entries'); setStatus('DRAFT'); setSearch(''); setScope(undefined); setPage(1); setRefresh((value) => value + 1);
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  const selectedDocuments = (data?.items ?? []).filter((item) => selectedIds.includes(item.id));
  const eligible = (action: string) => selectedDocuments.filter((item) => action === 'SUBMIT' ? item.status === 'DRAFT' && item.scope !== 'REFERENCE'
    : action === 'PUBLISH' ? item.status === 'IN_REVIEW' : item.status !== 'ARCHIVED');
  async function batchAction(action: string) {
    setBusy(true);
    let completed = 0;
    const failures: string[] = [];
    for (const item of eligible(action)) {
      try { await updateKnowledgeDocument(item.id, { action, expectedVersion: item.version ?? 1 }); completed++; }
      catch (error) { failures.push(`${item.title}：${error instanceof Error ? error.message : String(error)}`); }
    }
    setBusy(false); setRefresh((value) => value + 1);
    if (failures.length) message.warning({ content: `${actionNames[action]}成功 ${completed} 条，失败 ${failures.length} 条。${failures.slice(0, 2).join('；')}`, duration: 10 });
    else message.success(`${actionNames[action]}完成 ${completed} 条`);
  }
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  return <div className="ops-stack knowledge-workbench">
    <div className="kb-heading">
      <div><strong>企业知识与产品问答</strong><p>先核对资料，再审核发布。仅已发布条目参与回答，型号资料单独匹配。</p></div>
      <Space><Button icon={<ReloadOutlined />} onClick={() => setRefresh((value) => value + 1)}>刷新</Button>
        {canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={() => edit()}>新增知识</Button>}</Space>
    </div>
    <section className="ops-panel kb-panel">
      <Tabs activeKey={tab} onChange={(value) => { setTab(value); setPage(1); }} items={[
        { key: 'entries', label: '知识条目' }, { key: 'review', label: `待审核${data?.counts.review ? ` · ${data.counts.review}` : ''}` },
        { key: 'sources', label: '资料来源' }, { key: 'query', label: '问答测试' },
      ]} />
      {['entries', 'review'].includes(tab) && <>
        <div className="kb-toolbar">
          <Input.Search aria-label="搜索知识" placeholder="搜索问题、正文或标签" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} allowClear />
          <Select aria-label="筛选知识范围" placeholder="全部范围" allowClear value={scope} options={options(scopeNames)} onChange={(value) => { setScope(value); setPage(1); }} />
          {tab !== 'review' && <Select aria-label="筛选发布状态" placeholder="全部状态" allowClear value={status} options={options(statusNames)} onChange={(value) => { setStatus(value); setPage(1); }} />}
        </div>
        <p className="muted">已发布 {data?.coverage.publishedTopics ?? 0} 条知识 · 覆盖 {data?.coverage.questionForms ?? 0} 种问法 · 正文 {(data?.coverage.characters ?? 0).toLocaleString()} 字</p>
        <p className="muted">草稿 {data?.counts.drafts ?? 0} · 待审核 {data?.counts.review ?? 0} · 停用 {data?.counts.archived ?? 0}。同一答案的多种问法不重复计为知识。</p>
        {selectedIds.length > 0 && <Space wrap className="kb-batch-toolbar"><span>已选 {selectedIds.length} 条</span>
          {canEdit && <Button disabled={busy || !eligible('SUBMIT').length} onClick={() => void batchAction('SUBMIT')}>批量送审（{eligible('SUBMIT').length}）</Button>}
          {canReview && <Popconfirm title={`确认已逐条核对来源及适用范围，发布 ${eligible('PUBLISH').length} 条知识？`} onConfirm={() => batchAction('PUBLISH')}><Button type="primary" disabled={busy || !eligible('PUBLISH').length}>批量发布（{eligible('PUBLISH').length}）</Button></Popconfirm>}
          {canEdit && <Popconfirm title={`停用 ${eligible('ARCHIVE').length} 条知识并保留历史？`} onConfirm={() => batchAction('ARCHIVE')}><Button danger disabled={busy || !eligible('ARCHIVE').length}>批量停用（{eligible('ARCHIVE').length}）</Button></Popconfirm>}
          <Button type="link" disabled={busy} onClick={() => setSelectedIds([])}>取消选择</Button>
        </Space>}
        <Table<KnowledgeDocument> rowKey="id" size="middle" loading={loading} dataSource={data?.items ?? []} scroll={{ x: 980 }}
          rowSelection={canEdit || canReview ? { selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys.map(String)), getCheckboxProps: () => ({ disabled: busy }) } : undefined}
          pagination={{ current: page, total: data?.total ?? 0, pageSize, showSizeChanger: true, pageSizeOptions: [20, 50, 100], onChange: (next, size) => { setPage(size !== pageSize ? 1 : next); setPageSize(size); }, showTotal: (total) => `共 ${total} 条` }}
          columns={[
            { title: '问题 / 资料', dataIndex: 'title', width: 290, render: (_, item) => <div><Button type="link" className="kb-title-button" onClick={() => edit(item)}>{item.title}</Button>
              <small className="kb-subtext">{categoryNames[item.category]} · v{item.revision ?? 1}{item.modelIds?.length ? ` · ${item.modelIds.join('、')}` : ''}</small></div> },
            { title: '范围 / 状态', width: 165, render: (_, item) => <Space orientation="vertical" size={4}><Tag>{scopeNames[item.scope ?? 'GENERAL']}</Tag><Tag color={statusColors[item.status]}>{statusNames[item.status]}</Tag></Space> },
            { title: '依据', width: 240, render: (_, item) => <div>{sourceMap.get(item.sourceId ?? '')?.title ?? '未关联来源'}<small className="kb-subtext">{item.sourceLocation || '未标注页码 / 章节'}</small>
              {item.updatedBy === 'initial-curation' && <small className="kb-subtext">首批资料整理；尚非企业人工签审</small>}</div> },
            { title: '更新', width: 160, render: (_, item) => <div>{date(item.updatedAt)}<small className="kb-subtext">{item.updatedBy ?? '历史导入'}</small></div> },
            { title: '操作', width: 235, render: (_, item) => <Space wrap size={4}>
              {canEdit && item.status !== 'ARCHIVED' && <Button size="small" disabled={busy} onClick={() => edit(item)}>编辑</Button>}
              {canEdit && item.status === 'DRAFT' && item.scope !== 'REFERENCE' && <Button size="small" disabled={busy} onClick={() => void action(item, 'SUBMIT')}>送审</Button>}
              {canReview && item.status === 'IN_REVIEW' && <><Popconfirm title="确认核对来源并发布此版本？" onConfirm={() => action(item, 'PUBLISH')}><Button type="primary" size="small" disabled={busy}>审核发布</Button></Popconfirm>
                <Button size="small" disabled={busy} onClick={() => { setRejecting(item); setRejectReason(''); }}>退回</Button></>}
              {canEdit && item.status !== 'ARCHIVED' && <Popconfirm title="停用后将不再参与问答，记录仍保留。" onConfirm={() => action(item, 'ARCHIVE')}><Button size="small" danger disabled={busy}>停用</Button></Popconfirm>}
              {canEdit && item.status === 'ARCHIVED' && <Button size="small" disabled={busy} onClick={() => void action(item, 'RESTORE')}>恢复草稿</Button>}
              <Button size="small" type="link" onClick={() => void showHistory(item)}>版本记录</Button>
            </Space> },
          ]} />
      </>}
      {tab === 'sources' && <SourceList sources={sources} canEdit={canEdit} onPreview={showSource} onUploaded={(result) => { setPreview(result); setRefresh((value) => value + 1); }} />}
      {tab === 'query' && <KnowledgeQuery sources={sources} />}
    </section>
    <Drawer title={editor?.id ? `${canEdit ? '编辑' : '查看'}知识 · v${editor.revision ?? 1}` : '新增知识草稿'} size={760} open={editor !== null} onClose={() => setEditor(null)} destroyOnHidden
      extra={canEdit && editor?.status !== 'ARCHIVED' ? <Button type="primary" loading={saving} onClick={() => void save()}>保存草稿</Button> : null}>
      {editor?.status === 'PUBLISHED' && <Alert type="info" showIcon title="保存后生成新草稿，审核发布前不影响当前回答。" />}
      <Form form={form} layout="vertical" disabled={!canEdit || editor?.status === 'ARCHIVED'} className="kb-form">
        <Form.Item name="title" label="问题 / 知识标题" rules={[{ required: true }]}><Input maxLength={200} /></Form.Item>
        <div className="kb-form-grid"><Form.Item name="scope" label="适用范围" rules={[{ required: true }]}><Select options={options(scopeNames)} /></Form.Item>
          <Form.Item name="category" label="内容分类" rules={[{ required: true }]}><Select options={options(categoryNames)} /></Form.Item></div>
        {selectedScope === 'MODEL' && <Form.Item name="modelIds" label="适用型号（必须与设备型号一致）" rules={[{ required: true }]}><Select mode="tags" tokenSeparators={[',', '，']} open={false} /></Form.Item>}
        {selectedScope === 'REFERENCE' && <Alert type="warning" title="内部参考内容不能发布为用户问答。" />}
        <Form.Item name="sourceId" label="来源文件（送审前必填）"><Select allowClear showSearch optionFilterProp="label" options={sources.map((source) => ({ value: source.id, label: `${source.title}${source.scope === 'REFERENCE' ? ' · 仅参考' : ''}` }))} /></Form.Item>
        <Form.Item name="sourceLocation" label="来源位置（页码 / 章节，送审前必填）"><Input maxLength={200} placeholder="例如：第 3 页，公司概况" /></Form.Item>
        <Form.Item name="content" label="经核对的正文 / 答案" rules={[{ required: true }]}><Input.TextArea rows={11} maxLength={30000} showCount /></Form.Item>
        <Form.Item name="questionVariants" label="等价问法（仅填写与本答案完全对应的问题）"><Select mode="tags" tokenSeparators={['\n']} open={false} placeholder="输入一条后回车" /></Form.Item>
        <Form.Item name="tags" label="检索标签"><Select mode="tags" tokenSeparators={[',', '，']} open={false} /></Form.Item>
      </Form>
    </Drawer>
    <Modal title={preview?.source.title} open={Boolean(preview)} onCancel={() => { if (!busy) setPreview(undefined); }} width={1000} footer={preview ? <Space wrap>
      <Button onClick={() => void downloadKnowledgeSource(preview.source).catch(report)}>下载原文件</Button>
      {canEdit && <Button disabled={!preview.text || busy} onClick={() => { edit({ title: preview.source.title, content: preview.text.slice(0, 30000), scope: preview.source.scope ?? 'REFERENCE', sourceId: preview.source.id }); setPreview(undefined); }}>整理为草稿</Button>}
      {canEdit && <Button type="primary" loading={busy} disabled={!sectionIds.length || sectionIds.length > 200 || (preview.source.scope === 'MODEL' && !importModels.length)} onClick={() => void importSections()}>批量整理为草稿（{sectionIds.length}）</Button>}
    </Space> : null}>
      <Alert type="info" title={preview?.note} /><p className="muted">{preview?.source.fileName} · {preview?.source.note}</p>
      <Tabs key={preview?.source.id} defaultActiveKey="sections" items={[
        { key: 'sections', label: `可整理章节 · ${preview?.sections.length ?? 0}`, children: <>
          <p>每段保留原文件位置，导入后为草稿。重复导入会跳过已整理章节；单次最多 200 段。</p>
          {preview?.source.scope === 'REFERENCE' && <Alert type="warning" title="本文件为内部参考，导入内容不能发布为用户问答。" />}
          {preview?.source.scope === 'MODEL' && <label>适用型号<Select aria-label="批量导入适用型号" mode="tags" value={importModels} onChange={setImportModels} tokenSeparators={[',', '，']} open={false} style={{ width: '100%', margin: '8px 0' }} /></label>}
          <Table<SourceSection> rowKey="id" size="small" dataSource={preview?.sections ?? []} pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 650 }}
            rowSelection={canEdit ? { selectedRowKeys: sectionIds, preserveSelectedRowKeys: true, onChange: (keys) => setSectionIds(keys.map(String)), getCheckboxProps: () => ({ disabled: busy }) } : undefined}
            columns={[{ title: '来源位置', dataIndex: 'location', width: 190 }, { title: '正文预览', render: (_, section) => <details><summary>{section.text.slice(0, 115)}{section.text.length > 115 ? '…' : ''}</summary><pre className="kb-source-text">{section.text}</pre></details> }, { title: '字数', width: 70, render: (_, section) => section.text.length }]} />
        </> },
        { key: 'text', label: '提取全文', children: <><pre className="kb-source-text">{preview?.text || '暂无可用文字。'}</pre>
          {(preview?.text.length ?? 0) > 30000 && <p>单条草稿仅复制前 30,000 字，请使用章节批量整理。</p>}</> },
      ]} />
    </Modal>
    <Drawer title={`版本与操作记录 · ${historyTitle}`} size={800} open={historyOpen} onClose={() => setHistoryOpen(false)}>
      <Table<KnowledgeDocument> loading={historyLoading} rowKey="id" size="small" dataSource={history?.versions ?? []} pagination={false} columns={[
        { title: '版本', render: (_, item) => `v${item.revision ?? 1}` }, { title: '状态', render: (_, item) => statusNames[item.status] },
        { title: '更新人', dataIndex: 'updatedBy' }, { title: '时间', dataIndex: 'updatedAt', render: date },
        { title: '正文', render: (_, item) => <Button size="small" onClick={() => Modal.info({ title: item.title, width: 700, content: <pre className="kb-source-text">{item.content}</pre> })}>查看</Button> },
      ]} />
      {history?.events.map((event) => <article className="kb-history-event" key={event.id}><strong>{actionNames[event.action] ?? event.action}</strong><span>{event.actor} · {date(event.at)}</span>
        {event.reason && <p>{event.reason}</p>}<details><summary>查看当时内容</summary><pre className="kb-source-text">{event.snapshot.content}</pre></details></article>)}
    </Drawer>
    <Modal title="退回修改" open={Boolean(rejecting)} onCancel={() => setRejecting(undefined)} confirmLoading={busy} onOk={() => rejecting && void action(rejecting, 'REJECT', rejectReason)} okButtonProps={{ disabled: !rejectReason.trim() }}>
      <Input.TextArea aria-label="退回原因" placeholder="请填写待核对或修改的内容" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} maxLength={500} />
    </Modal>
  </div>;
}

function SourceList({ sources, canEdit, onPreview, onUploaded }: { sources: KnowledgeSource[]; canEdit: boolean; onPreview: (source: KnowledgeSource) => void; onUploaded: (result: SourcePreview) => void }) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File>();
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState<KnowledgeScope>('REFERENCE');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function upload() {
    if (!file || !title.trim()) return;
    if (file.size > 6 * 1024 * 1024) { message.error('单个文件最多 6 MB'); return; }
    setBusy(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
      const result = await uploadKnowledgeSource({ title, fileName: file.name, base64, scope, note });
      setOpen(false); onUploaded(result); message.success('资料已上传，尚未发布为问答');
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <>
    <div className="kb-heading"><p>原文件用于追溯；提取文字后仍需整理、审核，文件上传本身不会直接改变回答。</p>
      {canEdit && <Button aria-label="上传资料" icon={<UploadOutlined />} onClick={() => { setOpen(true); setFile(undefined); setTitle(''); setNote(''); setScope('REFERENCE'); }}>上传资料</Button>}</div>
    <Table<KnowledgeSource> rowKey="id" dataSource={[...sources].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))} size="middle" scroll={{ x: 900 }} pagination={{ pageSize: 12, showSizeChanger: false }} columns={[
      { title: '资料', width: 320, render: (_, source) => <div><strong>{source.title}</strong><small className="kb-subtext">{source.fileName}</small></div> },
      { title: '范围', width: 120, render: (_, source) => <Tag>{scopeNames[source.scope ?? 'REFERENCE']}</Tag> },
      { title: '整理状态', width: 140, render: (_, source) => <Tag color={source.processingStatus === 'EXTRACTED' ? 'blue' : 'default'}>{processingNames[source.processingStatus]}</Tag> },
      { title: '说明', dataIndex: 'note' }, { title: '操作', width: 90, render: (_, source) => <Button size="small" disabled={['MEDIA_GROUP', 'ARCHIVE'].includes(source.kind)} onClick={() => onPreview(source)}>查看原文</Button> },
    ]} />
    <Modal title="上传知识来源" open={open} onCancel={() => setOpen(false)} onOk={() => void upload()} confirmLoading={busy} okButtonProps={{ disabled: !file || !title.trim() }}>
      <div className="kb-form"><label>原始文件<Input type="file" aria-label="选择资料文件" accept=".txt,.md,.docx,.pptx,.xlsx,.pdf" onChange={(event) => { const selected = event.target.files?.[0]; setFile(selected); setTitle(selected?.name ?? ''); }} /></label>
        <label>资料名称<Input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>资料范围<Select aria-label="上传资料范围" value={scope} options={options(scopeNames)} onChange={setScope} /></label>
        <label>版本与备注<Input.TextArea value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} /></label>
        <p className="muted">支持 UTF-8 TXT / Markdown、DOCX、PPTX、XLSX、PDF；每份最多 6 MB。扫描件需另做 OCR 校对。</p></div>
    </Modal>
  </>;
}

function KnowledgeQuery({ sources }: { sources: KnowledgeSource[] }) {
  const { message } = App.useApp();
  const [question, setQuestion] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<KnowledgeQueryResponse>();
  const [tested, setTested] = useState({ question: '', model: '' });
  async function run() {
    setBusy(true); setResult(undefined);
    const input = { question: question.trim(), model: model.trim() };
    try { setResult(await queryKnowledge(input.question, input.model || undefined)); setTested(input); }
    catch (error) { message.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  function exportResult() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...tested, result, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `知识问答-${Date.now()}.json`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="kb-query">
    <p>核对问答内容及资料依据。此处只返回文字；相关问题调用已配置的默认 LLM，可能产生少量费用。</p>
    <div className="kb-query-input"><Input.TextArea aria-label="知识问答问题" placeholder="例如：东信是一家什么企业？" value={question} maxLength={2000} rows={3} onChange={(event) => setQuestion(event.target.value)} />
      <Input aria-label="问答适用型号" placeholder="适用型号（可选，留空只查企业及通用知识）" value={model} maxLength={100} onChange={(event) => setModel(event.target.value)} />
      <Button aria-label="测试问答" type="primary" loading={busy} disabled={!question.trim()} onClick={() => void run()}>测试问答</Button></div>
    {result ? <>
      <div className="kb-answer"><Space wrap><Tag color={result.usedFallback ? 'orange' : 'green'}>{result.route === 'FAQ' ? '已发布问答直接回答' : result.route === 'RAG' ? '检索资料 + LLM' : '资料不足 / 保守答复'}</Tag>
        <span className="muted">{result.latencyMs} ms</span><Button size="small" onClick={exportResult}>导出本次结果</Button></Space>
        <p>{result.answer}</p><small>{result.reason}</small></div>
      <h3>本次检索依据 · {result.hits.length} 条</h3>
      {result.hits.length ? result.hits.map((hit) => <article className="kb-hit" key={hit.documentId}><strong>{hit.title}</strong><p className="muted">{scopeNames[hit.scope ?? 'GENERAL']} · {sources.find((source) => source.id === hit.sourceId)?.title ?? '未标注来源'} · {hit.sourceLocation}</p>
        <pre>{hit.snippet}</pre><small className="muted">知识 ID：{hit.documentId} · 文字匹配分 {hit.score}（不代表回答准确率）</small></article>) : <Empty description="无已发布资料匹配；草稿、内部参考和其他型号资料不参与回答" />}
    </> : <Empty description="输入问题，查看回答及其资料依据" />}
  </div>;
}
