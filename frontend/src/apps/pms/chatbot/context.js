export function conversationInput(messages, text, locale = 'vi') {
  const context = [...messages, { role: 'user', content: text.trim() }]
    .map(({ role, content }) => ({ role, content: content.slice(0, 4000) }))
    .slice(-11)
  if (context[0]?.role === 'assistant') context.shift()
  while (context.length > 1 && context.reduce((sum, item) => sum + item.content.length, 0) > 16000)
    context.splice(0, 2)
  return { messages: context, locale }
}

export function embedPath(tenantId) {
  return '/id/chatbot/embed?' + new URLSearchParams({ tenant: tenantId })
}
