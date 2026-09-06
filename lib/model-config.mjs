import { requestModel } from './knowledge.mjs';

const str = value => typeof value === 'string' ? value.trim() : '';
const taskNames = ['answer', 'query', 'embedding'];
const emptyConfig = () => ({ version: 1, providers: [], models: [], tasks: { answer: '', query: '', embedding: '' } });

// Pure read adaptation: never writes or mutates the stored legacy settings.
export function normalizeModelConfig(raw, legacy = {}) {
  if (raw && Array.isArray(raw.providers) && Array.isArray(raw.models)) {
    return {
      version: 1,
      providers: raw.providers.map((provider, i) => ({ id: str(provider.id) || `provider-${i + 1}`, name: str(provider.name), baseUrl: str(provider.baseUrl), apiKey: str(provider.apiKey) })),
      models: raw.models.map((model, i) => ({ id: str(model.id) || `model-${i + 1}`, name: str(model.name), providerId: str(model.providerId), model: str(model.model), kind: model.kind === 'embedding' ? 'embedding' : 'chat' })),
      tasks: Object.fromEntries(taskNames.map(task => [task, str(raw.tasks?.[task])])),
    };
  }
  const result = emptyConfig();
  if (!legacy?.model && !legacy?.embeddingModel && !legacy?.apiKey) return result;
  result.providers.push({ id: 'legacy-provider', name: '原有模型服务', baseUrl: str(legacy.baseUrl), apiKey: str(legacy.apiKey) });
  if (legacy.model) { result.models.push({ id: 'legacy-answer', name: '原有问答模型', providerId: 'legacy-provider', model: str(legacy.model), kind: 'chat' }); result.tasks.answer = 'legacy-answer'; }
  if (legacy.embeddingModel) {
    const separate = legacy.embeddingBaseUrl && legacy.embeddingBaseUrl !== legacy.baseUrl;
    if (separate) result.providers.push({ id: 'legacy-embedding-provider', name: '原有向量服务', baseUrl: str(legacy.embeddingBaseUrl), apiKey: str(legacy.embeddingApiKey) });
    result.models.push({ id: 'legacy-embedding', name: '原有嵌入模型', providerId: separate ? 'legacy-embedding-provider' : 'legacy-provider', model: str(legacy.embeddingModel), kind: 'embedding' }); result.tasks.embedding = 'legacy-embedding';
  }
  return result;
}

export function publicModelConfig(config, legacy = {}) {
  const normalized = normalizeModelConfig(config, legacy);
  return { ...normalized, providers: normalized.providers.map(({ apiKey, ...provider }) => ({ ...provider, hasApiKey: !!apiKey })) };
}

export function validateModelConfig(config) {
  if (config.providers.length > 30 || config.models.length > 100) throw new Error('最多配置 30 个服务商与 100 个模型实例。');
  const providerIds = new Set(), modelIds = new Set();
  for (const provider of config.providers) {
    if (!/^[\w-]{1,100}$/.test(provider.id) || providerIds.has(provider.id)) throw new Error('服务商编号无效或重复，请重新添加该服务商。');
    providerIds.add(provider.id);
    if (!provider.name || provider.name.length > 100) throw new Error('每个服务商都需要一个不超过 100 字的显示名称。');
    let url;
    try { url = new URL(provider.baseUrl); } catch { throw new Error(`「${provider.name}」的接口地址无效，请填写完整 http(s) 地址。`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(`「${provider.name}」的接口地址不能含账号密码、查询参数或片段。API Key 请单独填写。`);
    if (provider.apiKey.length > 8192 || /[\r\n]/.test(provider.apiKey)) throw new Error(`「${provider.name}」的 API Key 格式无效。`);
  }
  for (const model of config.models) {
    if (!/^[\w-]{1,100}$/.test(model.id) || modelIds.has(model.id)) throw new Error('模型实例编号无效或重复，请重新添加该模型。');
    modelIds.add(model.id);
    if (!model.name || model.name.length > 100) throw new Error('每个模型实例都需要一个不超过 100 字的显示名称。');
    if (!model.model || model.model.length > 300 || /[\r\n]/.test(model.model)) throw new Error(`「${model.name}」需要填写服务商提供的真实模型 ID。`);
    if (!providerIds.has(model.providerId)) throw new Error(`「${model.name}」没有选择有效服务商。`);
  }
  for (const task of taskNames) {
    const id = config.tasks[task];
    if (!id) continue;
    const model = config.models.find(entry => entry.id === id);
    if (!model) throw new Error('任务绑定了已删除的模型，请重新选择。');
    if ((task === 'embedding') !== (model.kind === 'embedding')) throw new Error('语义检索需要嵌入模型；问答与检索词扩展需要对话模型。');
  }
  return config;
}

// Missing/blank API keys preserve server-side secrets. Removal is always explicit.
export function mergeModelConfig(existing, incoming) {
  if (!incoming || !Array.isArray(incoming.providers) || !Array.isArray(incoming.models)) throw new Error('模型配置需要服务商列表和模型列表。');
  const previous = normalizeModelConfig(existing);
  const merged = normalizeModelConfig(incoming);
  merged.providers = merged.providers.map(provider => {
    const sent = incoming.providers.find(entry => entry.id === provider.id) || {};
    const old = previous.providers.find(entry => entry.id === provider.id);
    return { ...provider, apiKey: sent.clearApiKey === true ? '' : str(sent.apiKey) || old?.apiKey || '' };
  });
  return validateModelConfig(merged);
}

export function resolveModelTasks(raw) {
  const config = normalizeModelConfig(raw);
  const resolve = task => {
    const model = config.models.find(entry => entry.id === config.tasks[task]);
    const provider = config.providers.find(entry => entry.id === model?.providerId);
    if (!model || !provider) return null;
    if ((task === 'embedding') !== (model.kind === 'embedding')) return null;
    return { model: model.model, baseUrl: provider.baseUrl, apiKey: provider.apiKey, instanceId: model.id, providerId: provider.id };
  };
  const answer = resolve('answer'), query = resolve('query'), embedding = resolve('embedding');
  return {
    baseUrl: answer?.baseUrl || '', model: answer?.model || '', apiKey: answer?.apiKey || '',
    queryBaseUrl: query?.baseUrl || '', queryModel: query?.model || '', queryApiKey: query?.apiKey || '',
    embeddingBaseUrl: embedding?.baseUrl || '', embeddingModel: embedding?.model || '', embeddingApiKey: embedding?.apiKey || '',
    taskInstances: { answer: answer?.instanceId || '', query: query?.instanceId || '', embedding: embedding?.instanceId || '' },
  };
}

export async function testModel(raw, modelId) {
  const config = validateModelConfig(normalizeModelConfig(raw));
  const model = config.models.find(entry => entry.id === modelId);
  if (!model) throw new Error('请先选择要测试的模型实例。');
  const provider = config.providers.find(entry => entry.id === model.providerId);
  const started = Date.now();
  const settings = { baseUrl: provider.baseUrl, apiKey: provider.apiKey, timeoutMs: 30000 };
  try {
    if (model.kind === 'embedding') {
      const result = await requestModel(settings, 'embeddings', { model: model.model, input: ['PaperDesk connection test.'] });
      const vector = result.data?.[0]?.embedding;
      if (!Array.isArray(vector) || !vector.length || vector.some(value => !Number.isFinite(value))) throw new Error('接口可连接，但没有返回有效的嵌入向量。请检查模型类型与模型 ID。');
      return { ok: true, message: `嵌入模型可用，返回 ${vector.length} 维向量。`, latencyMs: Date.now() - started, dimensions: vector.length };
    }
    const result = await requestModel(settings, 'chat/completions', { model: model.model, messages: [{ role: 'user', content: 'Connection test. Reply with only OK.' }] });
    if (typeof result.choices?.[0]?.message?.content !== 'string' || !result.choices[0].message.content.trim()) throw new Error('接口可连接，但没有返回可用文本。请确认该模型支持 chat/completions。');
    return { ok: true, message: '对话模型可用，已收到文本回答。', latencyMs: Date.now() - started };
  } catch (error) {
    let message = String(error.message || error);
    for (const item of config.providers) if (item.apiKey) message = message.split(item.apiKey).join('[密钥已隐藏]');
    throw new Error(message);
  }
}
