/**
 * Capability bindings for legacy tool plugins that predate `dsh.platform`.
 *
 * This is an adapter, not a replacement for plugin manifests. A plugin can
 * declare the same capability itself; buildCapabilityBrief and the tool map
 * deduplicate by capability id.
 */
export const LEGACY_CAPABILITY_BINDINGS = Object.freeze([
  { id: 'image.generate', kind: 'action', title: 'Generate image', family: 'image', bind: { tool: 'generate_image' } },
  { id: 'image.generate.batch', kind: 'action', title: 'Generate image batch', family: 'image', bind: { tool: 'generate_images' } },
  { id: 'image.edit', kind: 'action', title: 'Edit image', family: 'image', bind: { tool: 'edit_image' } },
  { id: 'image.cost', kind: 'knowledge', title: 'Estimate image cost', family: 'image', bind: { tool: 'estimate_image_cost' } },
  { id: 'image.prompt.enhance', kind: 'knowledge', title: 'Enhance image prompt', family: 'image', bind: { tool: 'enhance_prompt' } },
  { id: 'image.inspiration', kind: 'knowledge', title: 'Find image inspiration', family: 'image', bind: { tool: 'find_inspiration' } },
  { id: 'image.canvas.state', kind: 'perception', title: 'Read image canvas state', family: 'image', bind: { tool: 'canvas_state' } },
  { id: 'image.canvas.view', kind: 'perception', title: 'View image canvas', family: 'image', bind: { tool: 'view_canvas' } },
])
