import fs from 'node:fs';
import path from 'node:path';

const outPath = path.join(process.cwd(), 'data', 'test-sets.json');
const timestamp = '2026-08-17T00:00:00.000Z';

const simpleTemplates = [
  { category: '照明', intent: 'LIGHT_ON', base: '开灯', riskLevel: 'LOW' },
  { category: '照明', intent: 'LIGHT_OFF', base: '关灯', riskLevel: 'LOW' },
  { category: '夜灯', intent: 'NIGHT_LIGHT_ON', base: '打开夜灯', riskLevel: 'LOW' },
  { category: '夜灯', intent: 'NIGHT_LIGHT_OFF', base: '关闭夜灯', riskLevel: 'LOW' },
  { category: '取暖', intent: 'HEAT_WEAK_ON', base: '开弱暖', riskLevel: 'LOW' },
  { category: '取暖', intent: 'HEAT_STRONG_ON', base: '开强暖', riskLevel: 'MEDIUM' },
  { category: '取暖', intent: 'HEAT_WEAK_OFF', base: '关弱暖', riskLevel: 'LOW' },
  { category: '取暖', intent: 'HEAT_STRONG_OFF', base: '关强暖', riskLevel: 'LOW' },
  { category: '换气', intent: 'VENTILATION_ON', base: '打开换气', riskLevel: 'LOW' },
  { category: '换气', intent: 'VENTILATION_OFF', base: '关闭换气', riskLevel: 'LOW' },
  { category: '吹风', intent: 'FAN_ON', base: '打开吹风', riskLevel: 'LOW' },
  { category: '吹风', intent: 'FAN_OFF', base: '关闭吹风', riskLevel: 'LOW' },
  { category: '摆风', intent: 'SWING_ON', base: '开启摆风', riskLevel: 'LOW' },
  { category: '摆风', intent: 'SWING_OFF', base: '关闭摆风', riskLevel: 'LOW' },
  { category: '除湿', intent: 'DRY_ON', base: '打开干燥', riskLevel: 'LOW' },
  { category: '除湿', intent: 'DRY_OFF', base: '关闭干燥', riskLevel: 'LOW' },
  { category: '除雾', intent: 'DEFOG_ON', base: '打开除雾', riskLevel: 'LOW' },
  { category: '除雾', intent: 'DEFOG_OFF', base: '关闭除雾', riskLevel: 'LOW' },
  { category: '模式', intent: 'BATH_MODE_ON', base: '切到沐浴模式', riskLevel: 'LOW' },
  { category: '模式', intent: 'BATH_MODE_OFF', base: '退出沐浴模式', riskLevel: 'LOW' },
  { category: '温控', intent: 'CONSTANT_TEMP_ON', base: '打开恒温', riskLevel: 'MEDIUM' },
  { category: '温控', intent: 'CONSTANT_TEMP_OFF', base: '关闭恒温', riskLevel: 'LOW' },
  { category: '温控', intent: 'SET_TEMP', base: '把温度调到 {temp} 度', riskLevel: 'MEDIUM' },
  { category: '定时', intent: 'SET_TIMER', base: '设置 {minutes} 分钟后关闭', riskLevel: 'MEDIUM' },
  { category: '播报', intent: 'VOICE_BROADCAST_ON', base: '打开语音播报', riskLevel: 'LOW' },
  { category: '播报', intent: 'VOICE_BROADCAST_OFF', base: '关闭语音播报', riskLevel: 'LOW' },
  { category: '音量', intent: 'VOLUME_UP', base: '声音调大一点', riskLevel: 'LOW' },
  { category: '音量', intent: 'VOLUME_DOWN', base: '声音调小一点', riskLevel: 'LOW' },
  { category: '待机', intent: 'STANDBY', base: '全部关闭', riskLevel: 'MEDIUM' }
];

const complexTemplates = [
  { category: '情绪', intent: 'HEAT_WEAK_ON', base: '我有点冷，先帮我暖一下', riskLevel: 'MEDIUM' },
  { category: '场景', intent: 'LIGHT_ON', base: '我进浴室了，帮我把灯打开', riskLevel: 'LOW' },
  { category: '场景', intent: 'VENTILATION_ON', base: '洗完澡有点闷，帮我通下风', riskLevel: 'LOW' },
  { category: '售后', intent: null, base: 'E03 这个故障怎么处理', riskLevel: 'LOW' },
  { category: '售后', intent: null, base: '这个浴霸为什么一直报警', riskLevel: 'MEDIUM' },
  { category: '复合', intent: null, base: '先开灯，再开换气', riskLevel: 'MEDIUM' },
  { category: '复合', intent: null, base: '把温度调高一点，顺便把风也开大', riskLevel: 'MEDIUM' },
  { category: '边界', intent: null, base: '我洗澡快开始了，你先准备一下', riskLevel: 'LOW' },
  { category: '边界', intent: null, base: '现在别打扰我，先安静一点', riskLevel: 'LOW' },
  { category: '确认', intent: null, base: '要不要先给我开弱暖', riskLevel: 'MEDIUM' },
  { category: '确认', intent: null, base: '如果温度低就提醒我', riskLevel: 'MEDIUM' },
  { category: '温控', intent: 'SET_TEMP', base: '洗澡前先设到 {temp} 度', riskLevel: 'MEDIUM' },
  { category: '温控', intent: 'SET_TIMER', base: '离开前帮我设 {minutes} 分钟倒计时', riskLevel: 'MEDIUM' },
  { category: '模式', intent: 'BATH_MODE_ON', base: '我准备洗澡了，切到沐浴状态', riskLevel: 'LOW' },
  { category: '模式', intent: 'STANDBY', base: '洗完了，整机收起来吧', riskLevel: 'MEDIUM' },
  { category: '播报', intent: 'VOICE_BROADCAST_OFF', base: '晚上太吵了，把播报关掉', riskLevel: 'LOW' },
  { category: '播报', intent: 'VOICE_BROADCAST_ON', base: '我想听提示音，再把语音播报开一下', riskLevel: 'LOW' },
  { category: '除雾', intent: 'DEFOG_ON', base: '镜子起雾了，给我除一下', riskLevel: 'LOW' },
  { category: '待机', intent: 'STANDBY', base: '都关掉，省得一直耗电', riskLevel: 'MEDIUM' },
  { category: '边界', intent: null, base: '你先帮我分析下这个场景，别急着执行', riskLevel: 'LOW' }
];

const simplePrefixes = ['', '请', '麻烦帮我', '现在帮我', '直接'];
const simpleSuffixes = ['', '，谢谢', '，马上', '，现在就执行', '，尽快'];
const complexPrefixes = ['', '如果可以的话，', '麻烦先', '现在先', '帮我看看'];
const complexSuffixes = ['', '，我在洗澡', '，屋里有点潮', '，先别急', '，等我确认'];

function buildCases(prefixes, suffixes, templates, total) {
  const cases = [];
  let index = 0;
  while (cases.length < total) {
    const template = templates[index % templates.length];
    const variantIndex = Math.floor(index / templates.length);
    const prefix = prefixes[variantIndex % prefixes.length];
    const suffix = suffixes[Math.floor(variantIndex / prefixes.length) % suffixes.length];
    const temp = 36 + (variantIndex % 10);
    const minutes = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120][variantIndex % 10];
    const inputText = (prefix + template.base + suffix)
      .replace('{temp}', String(temp))
      .replace('{minutes}', String(minutes));

    cases.push({
      id: `case-${String(index + 1).padStart(4, '0')}`,
      category: template.category,
      inputText,
      expectedIntent: template.intent,
      riskLevel: template.riskLevel,
      notes: template.intent ? '自动生成简单/复杂测试语料' : '边界与澄清场景'
    });
    index += 1;
  }
  return cases;
}

function breakdown(cases) {
  const result = {};
  for (const item of cases) {
    result[item.category] = (result[item.category] || 0) + 1;
  }
  return result;
}

const simpleCases = buildCases(simplePrefixes, simpleSuffixes, simpleTemplates, 1000);
const complexCases = buildCases(complexPrefixes, complexSuffixes, complexTemplates, 1000);

const data = [
  {
    id: 'simple-1000',
    name: '1000条简单测试集',
    kind: 'SIMPLE',
    description: '基础单句、明确指令、低歧义',
    source: 'SYSTEM',
    isReadOnly: false,
    caseCount: simpleCases.length,
    categoryBreakdown: breakdown(simpleCases),
    createdAt: timestamp,
    updatedAt: timestamp,
    cases: simpleCases
  },
  {
    id: 'complex-1000',
    name: '1000条复杂测试集',
    kind: 'COMPLEX',
    description: '多意图、上下文、澄清、售后与边界表达',
    source: 'SYSTEM',
    isReadOnly: false,
    caseCount: complexCases.length,
    categoryBreakdown: breakdown(complexCases),
    createdAt: timestamp,
    updatedAt: timestamp,
    cases: complexCases
  }
];

fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
