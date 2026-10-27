/**
 * Generic creative/media collaboration policy. It intentionally names no
 * image-generation tool; capability skills provide tool-specific details.
 */
export function installCreativePrompt(agent, state, log) {
  if (state.creativePromptInstalled) return
  try {
    agent.ctx.systemPrompt.section({
      name: 'platform:creative',
      order: 160,
      text: [
        '进行创作、视觉设计或媒体生成时：',
        '先确认主体、用途、风格、构图、配色和必须保留的特征，再决定是否生成。',
        '只在能力允许时调用媒体生成/编辑能力；没有能力时继续文字讨论，并说明缺少的权限或配置。',
        '不要每轮都生成；在用户确认方向或到达自然节点时再执行。',
        '使用对应能力提供的 skill 或能力说明，按该能力的输入要求调用，不要猜测私有参数。',
        '媒体结果通过平台交付；不要直接调用 QQ、NapCat 或 OneBot。',
        '用户要求修改时，优先编辑已有结果并保留指定特征，而不是重新随机生成。',
      ].join(''),
    })
    state.creativePromptInstalled = true
  } catch (error) {
    log?.('warn', `could not add creative prompt: ${error?.message ?? error}`)
  }
}
