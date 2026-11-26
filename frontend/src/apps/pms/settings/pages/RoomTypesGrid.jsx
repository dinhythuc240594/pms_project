import { usePms } from '../../data/usePms.js'
import { t, useI18n } from '../../../../shared/i18n/useI18n.js'
import { MasterGrid } from './SettingsCatalogs.jsx'

export default function RoomTypesGrid() {
  useI18n()
  const { roomTypes, rooms, bedTypes = [], saveMaster } = usePms()
  const floors = [
    ...new Set([...rooms, ...roomTypes].map((row) => row.floor?.trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const rows = roomTypes.map((type) => ({
    ...type,
    roomNumbers: rooms
      .filter((room) => room.typeId === type.id && room.active !== false)
      .map((room) => room.id)
      .join(', '),
  }))
  const fields = [
    { key: 'code', label: 'Mã' },
    { key: 'name', label: 'Tên Loại Phòng' },
    { key: 'roomNumbers', label: 'Danh sách số phòng' },
    {
      key: 'floor',
      label: t('rooms.floor'),
      options: floors,
      maxLength: 120,
      hint: t('settings.roomTypeFloorHint'),
      createOption: (name) => ({ value: name, label: name }),
    },
    {
      key: 'bedTypeId',
      label: t('settings.beds'),
      options: bedTypes.map((bed) => ({
        value: bed.id,
        label: bed.name,
        disabled: bed.active === false,
      })),
      maxLength: 160,
      createOption: async (name) => {
        const bed = await saveMaster('bedTypes', { name })
        return { value: bed.id, label: bed.name }
      },
    },
    { key: 'capacity', label: 'Sức chứa', type: 'number', default: 2 },
    { key: 'price', label: 'Giá niêm yết', type: 'number' },
  ]
  const transform = (item) => {
    const floor = item.floor?.trim() || null
    const result = {
      ...item,
      floor,
      bedTypeId: item.bedTypeId || null,
      roomNumbers: item.roomNumbers
        .split(',')
        .map((number) => number.trim().replace(/^R(?=\d)/i, ''))
        .filter(Boolean),
    }
    // Price/name edits must preserve locations configured separately for each room.
    if (item.id && floor === (roomTypes.find((type) => type.id === item.id)?.floor || null))
      delete result.floor
    return result
  }
  return (
    <MasterGrid
      catalog="roomTypes"
      title={t('settings.roomTypes')}
      description={t('settingsUi.roomCount', {
        count: rooms.filter((room) => room.active !== false).length,
      })}
      rows={rows}
      fields={fields}
      transform={transform}
    />
  )
}
