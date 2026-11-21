import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'

export default function PlanDialog({ title, busy, error, onClose, children }) {
  useI18n()
  const ref = useRef(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className="hk-plan-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div className="hk-dialog-surface">
        <header className="hk-dialog-heading">
          <h2 id={titleId}>{labelUi(title)}</h2>
          <button
            type="button"
            className="hk-icon-button"
            aria-label={tUi('common.closeWindow')}
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        {error && (
          <p className="domain-error" role="alert">
            {error}
          </p>
        )}
        {children}
      </div>
    </dialog>
  )
}
