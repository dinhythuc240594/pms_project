import { tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { Link, useLocation } from 'react-router-dom'
import { RATE_MODES, writeRateParams } from '../rateModes'
import '../pages/RateModes.css'

// Domain-local switch between the four existing rate modes. Carries the current
// query string so rateStart/rateEnd/rateType and unrelated params survive.
export default function RateModeNav({ current, busy = false, context }) {
  useI18n()
  const { search } = useLocation()
  const targetSearch = context
    ? '?' + writeRateParams(new URLSearchParams(search), context)
    : search
  return (
    <nav className="rate-mode-nav" data-rate-nav="" aria-label={labelUi('Chế độ quản lý giá')}>
      <ul>
        {RATE_MODES.map((mode) => {
          const body = (
            <>
              <strong>{labelUi(mode.label)}</strong>
              <small>{labelUi(mode.hint)}</small>
            </>
          )
          return (
            <li key={mode.id}>
              {mode.id === current ? (
                <span
                  className="rate-mode-link is-current"
                  data-rate-mode={mode.id}
                  aria-current="page"
                >
                  {body}
                </span>
              ) : busy ? (
                <span
                  className="rate-mode-link is-disabled"
                  data-rate-mode={mode.id}
                  aria-disabled="true"
                  title={labelUi('Đang xử lý, vui lòng chờ')}
                >
                  {body}
                </span>
              ) : (
                <Link
                  className="rate-mode-link"
                  data-rate-mode={mode.id}
                  to={{ pathname: mode.path, search: targetSearch }}
                >
                  {body}
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
