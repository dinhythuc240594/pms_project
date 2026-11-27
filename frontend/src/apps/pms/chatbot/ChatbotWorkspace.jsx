import { useRef, useState } from 'react'
import Header from '../components/Header'
import ChatbotSidebar from './ChatbotSidebar'

export default function ChatbotWorkspace({ children, onOpenNavigation, tenantId }) {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const trigger = useRef(null)
  function close() {
    setOpen(false)
    trigger.current?.focus()
  }
  function toggle() {
    if (open) close()
    else {
      setLoaded(true)
      setOpen(true)
    }
  }
  return (
    <>
      <Header
        onOpenNavigation={onOpenNavigation}
        onToggleChatbot={toggle}
        chatbotOpen={open}
        chatbotTriggerRef={trigger}
      />
      <div className={`pms-workspace-body${open ? ' pms-workspace-chatbot-open' : ''}`}>
        {children}
        {loaded && <ChatbotSidebar open={open} tenantId={tenantId} onClose={close} />}
      </div>
    </>
  )
}
