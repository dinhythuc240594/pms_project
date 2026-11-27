const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh'

// Keep worldwide choices available on browsers without supportedValuesOf.
const FALLBACK_TIMEZONES = [
  'Africa/Accra',
  'Africa/Cairo',
  'Africa/Casablanca',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Nairobi',
  'America/Anchorage',
  'America/Argentina/Buenos_Aires',
  'America/Bogota',
  'America/Caracas',
  'America/Chicago',
  'America/Denver',
  'America/Halifax',
  'America/Lima',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/New_York',
  'America/Phoenix',
  'America/Santiago',
  'America/Sao_Paulo',
  'America/St_Johns',
  'America/Toronto',
  'America/Vancouver',
  'Antarctica/Casey',
  'Asia/Almaty',
  'Asia/Baghdad',
  'Asia/Bangkok',
  'Asia/Beirut',
  'Asia/Colombo',
  'Asia/Dhaka',
  'Asia/Dubai',
  'Asia/Hong_Kong',
  'Asia/Jakarta',
  'Asia/Jerusalem',
  'Asia/Kabul',
  'Asia/Karachi',
  'Asia/Kathmandu',
  'Asia/Kolkata',
  'Asia/Kuala_Lumpur',
  'Asia/Manila',
  'Asia/Riyadh',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Taipei',
  'Asia/Tehran',
  'Asia/Tokyo',
  'Asia/Yangon',
  'Atlantic/Azores',
  'Atlantic/Cape_Verde',
  'Atlantic/Reykjavik',
  'Australia/Adelaide',
  'Australia/Brisbane',
  'Australia/Darwin',
  'Australia/Eucla',
  'Australia/Lord_Howe',
  'Australia/Perth',
  'Australia/Sydney',
  'Europe/Amsterdam',
  'Europe/Athens',
  'Europe/Berlin',
  'Europe/Helsinki',
  'Europe/Istanbul',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Moscow',
  'Europe/Paris',
  'Europe/Rome',
  'Europe/Warsaw',
  'Indian/Maldives',
  'Indian/Mauritius',
  'Pacific/Apia',
  'Pacific/Auckland',
  'Pacific/Chatham',
  'Pacific/Fiji',
  'Pacific/Guam',
  'Pacific/Honolulu',
  'Pacific/Kiritimati',
  'Pacific/Marquesas',
  'Pacific/Noumea',
  'Pacific/Pago_Pago',
  'Pacific/Port_Moresby',
  'Pacific/Tahiti',
  'Pacific/Tongatapu',
]

export function hotelTimezoneOptions(current = DEFAULT_TIMEZONE) {
  const zones = Intl.supportedValuesOf?.('timeZone') || FALLBACK_TIMEZONES
  const now = new Date()
  // UTC and stored aliases are not necessarily returned by supportedValuesOf.
  return [...new Set(['UTC', DEFAULT_TIMEZONE, ...zones, current].filter(Boolean))]
    .map((value) => {
      try {
        const offset = new Intl.DateTimeFormat('en', {
          timeZone: value,
          timeZoneName: 'longOffset',
        })
          .formatToParts(now)
          .find((part) => part.type === 'timeZoneName')
          .value.replace('GMT', 'UTC')
        const [, sign, hours, minutes] = /^UTC(?:([+-])(\d{2}):(\d{2}))?$/.exec(offset)
        const order = sign ? (Number(hours) * 60 + Number(minutes)) * (sign === '-' ? -1 : 1) : 0
        return { value, label: `(${offset}) ${value}`, order }
      } catch {
        return { value, label: value, order: 0 }
      }
    })
    .sort((left, right) => left.order - right.order || left.value.localeCompare(right.value))
}
