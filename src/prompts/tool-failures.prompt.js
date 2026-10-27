/**
 * Generic tool failure policy. It does not name a plugin or a provider.
 */
export function installToolFailurePrompt(agent, state, log) {
  if (state.toolFailurePromptInstalled) return
  try {
    agent.ctx.systemPrompt.section({
      name: 'platform:tool-failures',
      order: 140,
      text: [
        '工具失败时：',
        '网络、TLS、连接重置、超时、5xx 属于可恢复错误；优先按工具声明的 operation/resume 恢复，不要重新提交会产生外部副作用或费用的请求。',
        '只有工具没有恢复契约时，才允许内部静默重试一次；最多一次，禁止循环调用。',
        '已经生成但下载或回传失败时，不要重新生成，优先重发已有结果。',
        '权限、额度、密钥、参数错误不要重试，直接说明需要开通、分配或修改什么。',
        '不要把内部失败细节、密钥或上游原始错误直接展示给用户。',
      ].join(''),
    })
    state.toolFailurePromptInstalled = true
  } catch (error) {
    log?.('warn', `could not add tool failure prompt: ${error?.message ?? error}`)
  }
}
