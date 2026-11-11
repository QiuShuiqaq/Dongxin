import type { KnowledgeDocument, KnowledgeSource } from '@dongxin/shared';
import { expandedKnowledgeDocuments } from './knowledgeCuratedExpansion.js';

const createdAt = '2026-10-27T00:00:00.000Z';

const sourceCatalogue: KnowledgeSource[] = [
  { id: 'dx-company-20260917', title: '东信企业简介（2026.9.17）', fileName: '东信-企业简介2026.9.17.pptx', relativePath: '公司资料收集（嘉/东信-企业简介2026.9.17.pptx', kind: 'PRESENTATION', processingStatus: 'EXTRACTED', note: '企业背景来源；宣传数字与其他版本不一致时不作为回答依据。' },
  { id: 'dx-company-new', title: '浙江东信电器企业介绍', fileName: '浙江东信电器-企业介绍（牛）.pptx', relativePath: '公司资料收集（嘉/浙江东信电器-企业介绍（牛）.pptx', kind: 'PRESENTATION', processingStatus: 'EXTRACTED', note: '企业背景来源；仅采用可交叉核对的事实。' },
  { id: 'dx-company-legacy', title: '浙江东信电器有限公司简介（吉柏利）', fileName: '浙江东信电器有限公司简介 (吉柏利).pptx', relativePath: '公司资料收集（嘉/浙江东信电器有限公司简介 (吉柏利).pptx', kind: 'PRESENTATION', processingStatus: 'EXTRACTED', note: '较早版本，仅供对照。' },
  { id: 'dx-company-doc', title: '东信企业基本概况', fileName: '东信-企业基本概况.doc', relativePath: '公司资料收集（嘉/东信-企业基本概况.doc', kind: 'DOCUMENT', processingStatus: 'CATALOGUED', note: '旧版 DOC，尚未抽取及核对。' },
  { id: 'dx-company-publicity', title: '东信宣传文稿', fileName: '东信-退役军人事务局 宣传 文稿.docx', relativePath: '公司资料收集（嘉/东信-退役军人事务局 宣传 文稿.docx', kind: 'DOCUMENT', processingStatus: 'EXTRACTED', note: '可按段落整理；人数、厂房面积、专利数量与其他版本存在差异，须人工核对。' },
  { id: 'mijia-s1-manual', title: '米家智能浴霸 S1 说明书（参考型号 MJYB03YL）', fileName: '米家智能浴霸S1  MJYB03YL  说明书-20260227.pdf', relativePath: '米家智能浴霸S1  MJYB03YL  说明书-20260227.pdf', kind: 'MANUAL', processingStatus: 'NEEDS_OCR', note: '仅供参考，不能作为东信 AI 浴霸型号事实。PDF 正文尚需 OCR 和人工校对。' },
  { id: 'mijia-s1-faults', title: '米家智能浴霸 S1 常见故障排查（参考型号 MJYB03YL）', fileName: '米家智能浴霸S1  MJYB03YL  产品常见故障排查指引-20261027.docx', relativePath: '米家智能浴霸S1  MJYB03YL  产品常见故障排查指引-20261027.docx', kind: 'DOCUMENT', processingStatus: 'EXTRACTED', note: '仅供内部参考；涉及拆机和电气检查，不直接面向消费者回答。' },
  { id: 'dx-ip-list', title: '东信知识产权清单', fileName: '东信知识产权清单(陆).xlsx', relativePath: '公司资料收集（嘉/东信知识产权清单(陆).xlsx', kind: 'SPREADSHEET', processingStatus: 'EXTRACTED', note: '已支持逐行提取；含失效、已弃和缺证书标注，先作为内部参考草稿。' },
  { id: 'dx-awards-list', title: '荣誉小集', fileName: '荣誉小集（陆）.xlsx', relativePath: '公司资料收集（嘉/荣誉小集（陆）.xlsx', kind: 'SPREADSHEET', processingStatus: 'EXTRACTED', note: '已支持逐行提取；需核对证书主体、有效期以及表内不一致项，先作为内部参考草稿。' },
  { id: 'dx-certificates', title: '荣誉资质图片及证书', fileName: '荣誉资质（吉柏利+东）', relativePath: '公司资料收集（嘉/荣誉资质（吉柏利+东）', kind: 'MEDIA_GROUP', processingStatus: 'CATALOGUED', note: '图片和 PDF 证书，不进入首版语音检索。' },
  { id: 'dx-factory-photos', title: '厂区照片', fileName: '厂区图片（若需公司照片视频可找卓莹莹）', relativePath: '公司资料收集（嘉/厂区图片（若需公司照片视频可找卓莹莹）', kind: 'MEDIA_GROUP', processingStatus: 'CATALOGUED', note: '仅作素材，不进入文字知识库。' },
  { id: 'dx-source-archive', title: '公司资料收集原始压缩包', fileName: '公司资料收集（嘉.zip', relativePath: '公司资料收集（嘉.zip', kind: 'ARCHIVE', processingStatus: 'DUPLICATE', note: '与已解压资料重复，不重复索引。' },
];

export const initialKnowledgeSources: KnowledgeSource[] = sourceCatalogue.map((source) => ({
  ...source, scope: source.id.startsWith('mijia-') || ['dx-ip-list', 'dx-awards-list'].includes(source.id) || source.processingStatus !== 'EXTRACTED' ? 'REFERENCE' : 'COMPANY',
}));

function entry(input: Pick<KnowledgeDocument, 'id' | 'title' | 'category' | 'content' | 'tags' | 'scope' | 'sourceId' | 'sourceLocation'>): KnowledgeDocument {
  return {
    ...input,
    status: 'PUBLISHED',
    modelIds: [],
    questionVariants: ({
      'dx-company-about': ['介绍一下东信', '介绍一下东信公司', '东信是什么公司', '东信公司介绍'],
      'dx-company-location': ['东信公司在哪里', '东信的地址在哪里', '东信位于哪里'],
      'dx-company-products': ['东信有哪些产品', '东信做什么产品', '东信的主营产品是什么'],
      'bath-heater-basic-functions': ['浴霸有什么基本功能', '浴霸通常有什么功能'],
      'dx-company-founded': ['东信什么时候成立的', '东信成立时间', '东信哪年成立'],
      'dx-company-oem': ['东信有代工业务吗', '东信提供OEM和ODM吗'],
      'dx-company-quality': ['东信如何进行质量管理', '东信的质量管理流程是什么'],
      'dx-company-laboratory': ['东信有哪些检测设备', '东信可以进行哪些检测'],
      'dx-company-mes': ['东信使用什么生产管理系统', '东信有没有MES系统'],
      'dx-company-brand': ['吉柏利是东信的品牌吗', '东信自己的品牌叫什么'],
    } as Record<string, string[]>)[input.id] ?? [],
    revision: 1,
    version: 1,
    updatedBy: 'initial-curation',
    reviewedBy: 'initial-curation',
    reviewedAt: createdAt,
    publishedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  };
}

export const initialKnowledgeDocuments: KnowledgeDocument[] = [
  ...expandedKnowledgeDocuments,
  entry({
    id: 'dx-company-about', title: '东信是一家什么企业？', category: 'OTHER',
    content: '浙江东信电器有限公司是一家位于浙江嘉兴的电器制造企业，主要从事浴霸等集成吊顶电器及相关产品的研发和生产。',
    tags: ['东信', '公司', '企业介绍', '主营业务'], scope: 'COMPANY', sourceId: 'dx-company-new', sourceLocation: '第 3 页“公司概况”',
  }),
  entry({
    id: 'dx-company-location', title: '东信在哪里？', category: 'OTHER',
    content: '浙江东信电器有限公司位于浙江省嘉兴市秀洲区王店镇。具体联系地址请以企业公布的最新地址为准。',
    tags: ['东信', '地址', '嘉兴', '王店'], scope: 'COMPANY', sourceId: 'dx-company-new', sourceLocation: '第 3 页“公司概况”',
  }),
  entry({
    id: 'dx-company-products', title: '东信主要生产什么产品？', category: 'PRODUCT',
    content: '东信的产品包括集成吊顶电器（浴霸）、室内取暖器、集成墙面和小家电。某一款浴霸的具体功能，应以该型号的正式说明书为准。',
    tags: ['东信', '浴霸', '产品', '主营产品'], scope: 'COMPANY', sourceId: 'dx-company-new', sourceLocation: '第 3 页“主营产品”',
  }),
  entry({
    id: 'dx-company-founded', title: '东信是什么时候成立的？', category: 'OTHER',
    content: '企业介绍资料记载，浙江东信电器有限公司成立于 2003 年 8 月。',
    tags: ['东信', '成立时间', '企业历史'], scope: 'COMPANY', sourceId: 'dx-company-new', sourceLocation: '第 3 页“公司概况”',
  }),
  entry({
    id: 'dx-company-oem', title: '东信是否开展 OEM、ODM 业务？', category: 'OTHER',
    content: '东信开展面向国内外电器品牌的 OEM、ODM 业务，涉及集成吊顶电器、室内取暖器等产品。具体合作范围及要求需要由业务人员确认。',
    tags: ['东信', 'OEM', 'ODM', '代工', '合作'], scope: 'COMPANY', sourceId: 'dx-company-new', sourceLocation: '第 3 页“公司简介”、第 4 页“服务模式”',
  }),
  entry({
    id: 'dx-company-quality', title: '东信的质量管理覆盖哪些环节？', category: 'OTHER',
    content: '企业介绍资料描述了从原材料、生产过程到成品出厂的质量管理流程。这是企业质量管理介绍，不能据此推断具体产品的质保期限或消费者售后承诺。',
    tags: ['东信', '质量管理', '质量流程'], scope: 'COMPANY', sourceId: 'dx-company-new', sourceLocation: '第 9 页“质量管理体系”',
  }),
  entry({
    id: 'dx-company-laboratory', title: '东信介绍了哪些产品检测能力？', category: 'OTHER',
    content: '企业资料列出了泄漏电流、接地电阻、灼热丝、针焰、盐雾、温升、寿命及环境模拟等检测设备或试验项目。这些属于企业检测条件介绍，不代表某一具体型号已经通过全部项目或取得相应认证。',
    tags: ['东信', '检测能力', '检测设备', '试验'], scope: 'COMPANY', sourceId: 'dx-company-new', sourceLocation: '第 10 页“检测与实验能力”',
  }),
  entry({
    id: 'dx-company-mes', title: '东信是否采用数字化生产管理？', category: 'OTHER',
    content: '企业资料介绍了 MES 生产管理和 ERP 库存管理，涉及生产批次、质量及责任环节的追溯，以及库存管理。资料未明确的系统接口、实时数据或具体产品追溯结果，需要另行核实。',
    tags: ['东信', 'MES', 'ERP', '生产管理', '数字化'], scope: 'COMPANY', sourceId: 'dx-company-new', sourceLocation: '第 12 页“数字化生产交付”',
  }),
  entry({
    id: 'dx-company-brand', title: '吉柏利与东信是什么关系？', category: 'OTHER',
    content: '东信的企业介绍将“吉柏利”列为自有品牌。不同品牌、不同型号的产品参数和售后规则仍需分别以对应正式资料为准。',
    tags: ['东信', '吉柏利', '品牌'], scope: 'COMPANY', sourceId: 'dx-company-new', sourceLocation: '第 14 页“吉柏利品牌”',
  }),
  entry({
    id: 'bath-heater-basic-functions', title: '浴霸通常有哪些基本功能？', category: 'USAGE',
    content: '常见浴霸可提供照明、取暖和换气等功能，但不同型号的配置不同。具体支持哪些功能以及操作方式，请以对应型号的说明书为准。',
    tags: ['浴霸', '照明', '取暖', '换气', '基本功能'], scope: 'GENERAL', sourceId: 'dx-company-20260917', sourceLocation: '第 11 页“发展阶段”',
  }),
  {
    id: 'mijia-s1-fault-reference', title: 'MJYB03YL 常见故障排查参考', category: 'TROUBLESHOOTING',
    content: '参考型号 MJYB03YL 的内部排查指引列出整机无反应、不取暖、不换气或吹风、照明不亮、数显不良、开关无法控制、无法连接 Wi-Fi、噪声大、摆页不工作等现象。该文件包含拆机及电气检查步骤，仅供内部分析，不能用于推断其他型号或直接指导消费者维修。',
    tags: ['MJYB03YL', '米家 S1', '故障排查'], status: 'DRAFT', scope: 'REFERENCE', modelIds: ['MJYB03YL'], questionVariants: [],
    sourceId: 'mijia-s1-faults', sourceLocation: '第 4 节“常见故障排查”', revision: 1, updatedBy: 'initial-curation', reviewedBy: null, reviewedAt: null, publishedAt: null, createdAt, updatedAt: createdAt,
  },
];
