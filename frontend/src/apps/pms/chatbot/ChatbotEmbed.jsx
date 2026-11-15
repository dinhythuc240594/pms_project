import { useEffect, useRef, useState } from 'react';
import { Send, RotateCcw } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { usePms } from '../data/usePms';
import { useI18n } from '../../../shared/i18n/useI18n.js';
import { conversationInput } from './context';
import './Chatbot.css';

export function ChatConversation({ request }) {
  const { t, locale } = useI18n();
  const [settings, setSettings] = useState(null);
  const [configVersion, setConfigVersion] = useState(0);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(null);
  const mounted = useRef(true), inFlight = useRef(false), bottom = useRef(null);
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    request('/chatbot/config', { signal: abort.signal, quiet: true }).then(result => { if (!abort.signal.aborted) setSettings(result); })
      .catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => { mounted.current = false; abort.abort(); };
  }, [request, configVersion]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [messages, busy]);
  async function deliver(intent) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await request('/chatbot/messages', { method: 'POST', body: intent.payload, intent: intent.key, quiet: true });
      if (mounted.current) { setMessages(previous => [...previous, result.reply]); setPending(null); }
    } catch (e) { if (mounted.current) setError(e.message); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  function send(event) {
    event.preventDefault();
    if (inFlight.current || pending || !text.trim() || !settings?.available) return;
    const intent = { key: crypto.randomUUID(), payload: conversationInput(messages, text, locale) };
    setMessages(previous => [...previous, { role: 'user', content: text.trim() }]);
    setText(''); setPending(intent); deliver(intent);
  }
  function reset() { if (inFlight.current) return; setMessages([]); setPending(null); setText(''); setError(''); setSettings(null); setConfigVersion(value => value + 1); }
  return <section className="pms-chat-embed" aria-label={t('chatbot.frameTitle')}>
    <header className="pms-chat-embed-toolbar"><span>{t('chatbot.poweredBy')}</span><button type="button" disabled={busy} onClick={reset} aria-label={t('chatbot.newConversation')}><RotateCcw size={15} aria-hidden="true" />{t('chatbot.newConversation')}</button></header>
    <div className="pms-chat-messages" role="log" aria-live="polite" aria-relevant="additions text" aria-label={t('chatbot.messages')}>
      {!messages.length && <p className="pms-chat-welcome">{t('chatbot.welcome')}</p>}
      {messages.map((message, index) => <article className={`pms-chat-message is-${message.role}`} key={index}><span>{message.role === 'user' ? t('chatbot.you') : t('chatbot.title')}</span><pre>{message.content}</pre></article>)}
      {busy && <p className="pms-chat-status" role="status">{t('chatbot.thinking')}</p>}<div ref={bottom} />
    </div>
    {error && <div className="pms-chat-error" role="alert"><p>{error}</p>{pending ? <button type="button" disabled={busy} onClick={() => deliver(pending)}>{t('chatbot.checkAgain')}</button> : !settings && <button type="button" onClick={() => { setError(''); setConfigVersion(value => value + 1); }}>{t('chatbot.checkAgain')}</button>}</div>}
    {settings && !settings.available && <p className="pms-chat-status" role="status">{t('chatbot.unavailable')}</p>}
    <form className="pms-chat-composer" onSubmit={send}><label htmlFor="chatbot-message">{t('chatbot.input')}</label><textarea id="chatbot-message" value={text} onChange={event => setText(event.target.value)} maxLength={4000} disabled={busy || Boolean(pending) || !settings?.available} placeholder={t('chatbot.placeholder')} /><button type="submit" disabled={busy || Boolean(pending) || !settings?.available || !text.trim()}><Send size={16} aria-hidden="true" />{t('chatbot.send')}</button></form>
  </section>;
}

export default function ChatbotEmbed() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const target = params.get('tenant');
  const { user, tenantId, selectTenant, requestTenant, authGeneration } = usePms();
  const allowed = user?.memberships?.some(m => m.tenantId === target && m.active !== false);
  const [selectionError, setSelectionError] = useState('');
  useEffect(() => {
    if (!allowed || tenantId === target) return;
    let current = true;
    Promise.resolve(selectTenant(target)).catch(error => { if (current) setSelectionError(error.message); });
    return () => { current = false; };
  }, [target, tenantId, allowed, selectTenant]);
  if (!allowed) return <p className="pms-chat-status" role="alert">{t('chatbot.tenantDenied')}</p>;
  if (selectionError) return <p className="pms-chat-status" role="alert">{selectionError}</p>;
  if (tenantId !== target) return <p className="pms-chat-status" role="status">{t('common.loading')}</p>;
  return <ChatConversation key={`${target}:${user?.id}:${authGeneration}`} request={requestTenant} />;
}
