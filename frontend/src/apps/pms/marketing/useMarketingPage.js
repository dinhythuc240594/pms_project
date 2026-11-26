import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useDraftGuard } from '../../../shared/drafts/DraftGuardProvider'
import { createMarketingApi, errorText } from './api'

export default function useMarketingPage(request, pageId) {
  const api = useMemo(() => createMarketingApi(request), [request])
  const [page, setPage] = useState(null)
  const [document, setDocument] = useState(null)
  const [library, setLibrary] = useState({ templates: [], aiAvailable: false })
  const [html, setHtml] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('edit')
  const [artifact, setArtifact] = useState(null)
  const [job, setJob] = useState(null)
  const [releases, setReleases] = useState([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const alive = useRef(true)
  const pending = useRef(false)
  const dirtyRef = useRef(false)
  const operationVersion = useRef(0)
  const dirty = Boolean(
    page && document && JSON.stringify(page.document) !== JSON.stringify(document),
  )
  useLayoutEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])
  const { requestLeave } = useDraftGuard({
    dirty: () => dirtyRef.current,
    pending: () => pending.current,
  })
  const base = `/pages/${encodeURIComponent(pageId)}`
  const load = useCallback(
    async (signal) => {
      const version = ++operationVersion.current
      try {
        const [next, templates] = await Promise.all([
          request(base, { signal }),
          request('/templates', { signal }),
        ])
        if (alive.current && version === operationVersion.current) {
          setPage(next)
          setDocument(next.document)
          setLibrary(templates)
          setArtifact(null)
          setStage('edit')
          setJob(null)
          setError('')
          dirtyRef.current = false
        }
      } catch (e) {
        if (alive.current && !signal?.aborted && version === operationVersion.current)
          setError(errorText(e))
      }
    },
    [request, base],
  )
  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    const timer = setTimeout(() => load(controller.signal), 0)
    return () => {
      alive.current = false
      operationVersion.current += 1
      clearTimeout(timer)
      controller.abort()
    }
  }, [load])
  useEffect(() => {
    if (!document || stage !== 'edit') return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      request(base + '/preview', {
        method: 'POST',
        body: { document },
        readOnly: true,
        quiet: true,
        signal: controller.signal,
      })
        .then((result) => {
          if (alive.current && !controller.signal.aborted) {
            setHtml(result.html)
            setPreviewError('')
          }
        })
        .catch((e) => {
          if (alive.current && !controller.signal.aborted) setPreviewError(errorText(e))
        })
    }, 350)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [request, base, document, stage])
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return
    const controller = new AbortController()
    const timer = setTimeout(
      () => {
        request(`/generation-jobs/${encodeURIComponent(job.id)}`, {
          signal: controller.signal,
          quiet: true,
        })
          .then((result) => {
            if (alive.current && !controller.signal.aborted) setJob(result)
          })
          .catch((e) => {
            if (alive.current && !controller.signal.aborted) {
              setError(errorText(e))
              setJob((previous) => ({ ...previous, pollStopped: true }))
            }
          })
      },
      job.pollStopped ? 10000 : 2000,
    )
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [request, job])

  async function run(action) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      return await action()
    } catch (e) {
      if (alive.current) setError(errorText(e))
      return undefined
    } finally {
      pending.current = false
      if (alive.current) setBusy(false)
    }
  }
  function accept(next) {
    if (!alive.current) return
    setPage(next)
    setDocument(next.document)
    dirtyRef.current = false
  }
  async function saveIfDirty() {
    if (!dirtyRef.current) return page
    const next = await request(base + '/revisions', {
      method: 'POST',
      body: {
        expectedVersion: page.version,
        baseRevisionId: page.workingRevisionId,
        document,
      },
    })
    accept(next)
    setArtifact(null)
    return next
  }
  const save = () =>
    run(async () => {
      const next = await saveIfDirty()
      if (alive.current) setNotice(`Đã lưu bản nháp v${next.revisionNumber}.`)
    })
  const review = () =>
    run(async () => {
      const next = await saveIfDirty()
      if (!alive.current) return
      const snapshot = await request(base + '/review-requests', {
        method: 'POST',
        body: { expectedVersion: next.version },
      })
      if (alive.current) {
        setArtifact(snapshot)
        setStage('review')
        setNotice(`Đang xem đúng bản nháp v${next.revisionNumber}.`)
      }
    })
  const decide = (decision, checklist, note) =>
    run(async () => {
      const next = await request(base + '/reviews', {
        method: 'POST',
        body: {
          expectedVersion: page.version,
          artifactId: artifact.artifactId,
          manifestHash: artifact.manifestHash,
          decision,
          checklist,
          note,
        },
      })
      accept(next)
      if (alive.current) {
        setNotice(
          decision === 'approved'
            ? `Đã duyệt v${next.revisionNumber}. Bạn có thể xuất bản.`
            : 'Đã ghi nhận yêu cầu chỉnh sửa.',
        )
        if (decision === 'changes_requested') setStage('edit')
      }
    })
  const publish = () =>
    run(async () => {
      const next = await api.mutation(base + '/publish', {
        expectedVersion: page.version,
        expectedPublishedReleaseId: page.publishedReleaseId,
        approvalId: page.review?.id,
        manifestHash: artifact.manifestHash,
      })
      accept(next)
      if (alive.current) setNotice(`Đã xuất bản phiên bản v${next.revisionNumber}.`)
    })
  const unpublish = () =>
    run(async () => {
      const next = await api.mutation(base + '/unpublish', {
        expectedVersion: page.version,
        expectedPublishedReleaseId: page.publishedReleaseId,
      })
      // Unpublishing must not discard an unrelated unsaved draft.
      if (alive.current) {
        setPage(next)
        setNotice('Đã gỡ trang công khai. Bản nháp và lịch sử vẫn được giữ.')
      }
    })
  const openHistory = () =>
    run(async () => {
      const result = await request(base + '/releases')
      if (alive.current) {
        setReleases(result.releases)
        setHistoryOpen(true)
      }
    })
  const restore = (releaseId) =>
    run(async () => {
      const next = await api.mutation(base + '/restore', {
        expectedVersion: page.version,
        expectedPublishedReleaseId: page.publishedReleaseId,
        targetReleaseId: releaseId,
      })
      if (alive.current) {
        setPage(next)
        setHistoryOpen(false)
        setNotice('Đã khôi phục trang công khai. Bản nháp không thay đổi.')
      }
    })
  const generate = (prompt, sectionId) =>
    run(async () => {
      const next = await saveIfDirty()
      if (!alive.current) return
      const result = await api.mutation(base + '/generations', {
        expectedVersion: next.version,
        baseRevisionId: next.workingRevisionId,
        prompt,
        ...(sectionId ? { sectionId } : {}),
      })
      if (alive.current) {
        setJob(result)
        setNotice('Đã gửi yêu cầu. Bạn có thể tiếp tục xem trang trong lúc AI xử lý.')
      }
    })
  const apply = () =>
    run(async () => {
      if (dirtyRef.current)
        throw new Error(
          'Bản nháp có thay đổi chưa lưu. Lưu nội dung rồi tạo đề xuất mới để tránh ghi đè.',
        )
      const next = await api.mutation(`/generation-jobs/${encodeURIComponent(job.id)}/apply`, {
        expectedVersion: page.version,
      })
      accept(next)
      if (alive.current) {
        setJob(null)
        setNotice('Đã áp dụng đề xuất vào bản nháp. Cần xem trước và duyệt lại.')
      }
    })
  const uploadImage = (file, sectionId) =>
    run(async () => {
      if (
        !file ||
        file.size > 700000 ||
        !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
      )
        throw new Error('Chọn ảnh JPEG, PNG hoặc WebP tối đa 700 KB.')
      const encoded = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1])
        reader.onerror = () => reject(new Error('Không thể đọc ảnh đã chọn.'))
        reader.readAsDataURL(file)
      })
      if (!alive.current) return
      const result = await request('/assets', { method: 'POST', body: { data: encoded } })
      if (alive.current) {
        setDocument((previous) => ({
          ...previous,
          sections: previous.sections.map((section) =>
            section.id === sectionId ? { ...section, imageUrl: result.url } : section,
          ),
        }))
        setNotice('Đã tải ảnh. Bổ sung mô tả ảnh và lưu bản nháp.')
      }
    })
  return {
    page,
    document,
    setDocument,
    library,
    html: stage === 'review' ? artifact?.html || '' : html,
    previewError: stage === 'review' ? '' : previewError,
    error,
    notice,
    busy,
    dirty,
    stage,
    artifact,
    job,
    releases,
    historyOpen,
    setHistoryOpen,
    save,
    review,
    decide,
    publish,
    unpublish,
    openHistory,
    restore,
    generate,
    apply,
    uploadImage,
    setStage,
    reload: () => requestLeave(() => load()),
  }
}
