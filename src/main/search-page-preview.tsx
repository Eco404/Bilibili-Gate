import { useHover, useMemoizedFn, useUnmountedRef } from 'ahooks'
import { throttle } from 'es-toolkit'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSnapshot } from 'valtio'
import { APP_SHORT_PREFIX, createReactRoot } from '$common'
import { useRefStateBox } from '$common/hooks/useRefState'
import { AppRoot } from '$components/AppRoot'
import { useLargePreviewRelated } from '$components/LargePreview/useLargePreview'
import { defaultRecSharedEmitter } from '$components/Recommends/rec.shared'
import { PreviewImage } from '$components/VideoCard/child-components/PreviewImage'
import { fetchImagePreviewData, isImagePreviewDataValid, type ImagePreviewData } from '$components/VideoCard/services'
import { usePreviewRelated } from '$components/VideoCard/use/usePreviewRelated'
import { getVideoPageList } from '$modules/bilibili/video/video-detail'
import { settings } from '$modules/settings'
import { parseDuration } from '$utility/video'

const rootAttribute = `data-${APP_SHORT_PREFIX}-search-preview`

function parseSearchCard(card: HTMLElement) {
  const link = card.querySelector<HTMLAnchorElement>('.bili-video-card__wrap > a[href*="/video/"]')
  if (!link) return
  const url = new URL(link.href, location.href)
  const bvid = /^\/video\/(BV\w+)\/?$/i.exec(url.pathname)?.[1]
  if (!bvid) return // Live streams, bangumi and ads do not have videoshot data.
  const pageParam = Number(url.searchParams.get('p') || 1)
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1
  const coverHost = link.querySelector<HTMLElement>('.bili-video-card__image') ?? link
  const img = link.querySelector<HTMLImageElement>('picture.bili-video-card__cover img')
  const cover = img?.currentSrc || img?.src
  const titleEl = card.querySelector<HTMLElement>('.bili-video-card__info--tit')
  const title = titleEl?.title || titleEl?.textContent?.trim() || bvid
  const durationText = card.querySelector('.bili-video-card__stats__duration')?.textContent?.trim()
  const parsedDuration = parseDuration(durationText)
  const duration = Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : undefined
  return { bvid, page, coverHost, link, cover, title, duration }
}

type SearchCardInfo = NonNullable<ReturnType<typeof parseSearchCard>>

/** Search results can append cards or reuse the same DOM nodes for a different video. */
export function setupSearchPreviews(observerTarget: HTMLElement = document.body) {
  type Entry = {
    info: SearchCardInfo
    rootEl: HTMLElement
    overlayHost: HTMLElement
    root: ReturnType<typeof createReactRoot>
    restorePosition: () => void
  }
  const entries = new Map<HTMLElement, Entry>()
  let nextId = 0

  function remove(card: HTMLElement, entry: Entry) {
    entry.root.unmount()
    entry.rootEl.remove()
    entry.overlayHost.remove()
    entry.restorePosition()
    entries.delete(card)
  }

  const scan = throttle(() => {
    for (const [card, entry] of entries) {
      if (!observerTarget.contains(card)) remove(card, entry)
    }
    for (const card of observerTarget.querySelectorAll<HTMLElement>('.bili-video-card')) {
      const info = parseSearchCard(card)
      const entry = entries.get(card)
      if (entry) {
        const prev = entry.info
        if (
          info &&
          entry.rootEl.parentElement === card &&
          entry.overlayHost.parentElement === info.coverHost &&
          prev.bvid === info.bvid &&
          prev.page === info.page &&
          prev.link === info.link &&
          prev.coverHost === info.coverHost &&
          prev.cover === info.cover &&
          prev.title === info.title &&
          prev.duration === info.duration
        )
          continue
        remove(card, entry)
      }
      if (!info) continue

      const rootEl = document.createElement('div')
      rootEl.setAttribute(rootAttribute, '')
      rootEl.style.display = 'contents'
      card.append(rootEl)
      const { coverHost } = info
      const originalPosition = coverHost.style.position
      const needsPosition = getComputedStyle(coverHost).position === 'static'
      if (needsPosition) coverHost.style.position = 'relative'
      // Own a separate container so native re-renders can detach it without deleting React's children.
      const overlayHost = document.createElement('div')
      overlayHost.dataset.biliGateSearchOverlay = 'host'
      Object.assign(overlayHost.style, {
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none',
        borderRadius: 'inherit',
      })
      coverHost.append(overlayHost)
      const root = createReactRoot(rootEl)
      entries.set(card, {
        info,
        root,
        rootEl,
        overlayHost,
        restorePosition() {
          if (needsPosition && coverHost.style.position === 'relative') coverHost.style.position = originalPosition
        },
      })
      root.render(
        <AppRoot>
          <SearchCardPreview info={info} card={card} overlayHost={overlayHost} uniqId={`search-preview-${++nextId}`} />
        </AppRoot>,
      )
    }
  }, 300)

  scan()
  const observer = new MutationObserver((records) => {
    // Ignore our own animations/player updates; they do not change the native card data.
    if (
      records.some(
        ({ target }) =>
          !(target instanceof Element ? target : target.parentElement)?.closest(
            `[${rootAttribute}], [data-bili-gate-search-overlay]`,
          ),
      )
    ) {
      scan()
    }
  })
  observer.observe(observerTarget, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['href', 'src', 'srcset', 'title'],
  })
  return () => {
    observer.disconnect()
    scan.cancel()
    for (const [card, entry] of entries) remove(card, entry)
  }
}

function SearchCardPreview({
  info,
  card,
  overlayHost,
  uniqId,
}: {
  info: SearchCardInfo
  card: HTMLElement
  overlayHost: HTMLElement
  uniqId: string
}) {
  const { imgPreview, videoPreview } = useSnapshot(settings.videoCard)
  const snapshotEnabled = imgPreview.enabledOnSearchPage
  const [floatingVisible, setFloatingVisible] = useState(false)
  const [duration, setDuration] = useState(info.duration)
  const coverRef = useRef<HTMLElement | null>(info.link)
  const imagePreviewDataBox = useRefStateBox<ImagePreviewData | undefined>(undefined)
  const unmounted = useUnmountedRef()
  const pending = useRef<Promise<void> | undefined>(undefined)

  const tryFetchImagePreviewData = useMemoizedFn(async () => {
    if (isImagePreviewDataValid(imagePreviewDataBox.val)) return
    if (pending.current) return pending.current
    pending.current = (async () => {
      // Search cards sometimes show a collection's total duration. Use the selected part's duration.
      const pages = await getVideoPageList(info.bvid).catch(() => [])
      if (unmounted.current) return
      const page = pages.find((page) => page.page === info.page)
      if (!page && info.page !== 1) return // Never preview the first part for a link to a different part.
      const videoDuration = page?.duration || info.duration
      if (!videoDuration) return
      const data = await fetchImagePreviewData(info.bvid, page?.cid)
      if (unmounted.current) return
      setDuration(videoDuration)
      imagePreviewDataBox.set(data)
    })()
    try {
      await pending.current
    } finally {
      pending.current = undefined
    }
  })

  const { previewImgProps } = usePreviewRelated({
    uniqId,
    recSharedEmitter: defaultRecSharedEmitter,
    title: info.title,
    active: false,
    enabled: snapshotEnabled && !floatingVisible,
    videoDuration: duration,
    tryFetchImagePreviewData,
    imagePreviewDataBox,
    autoPreviewWhenHover: imgPreview.autoPreviewWhenHover,
    videoPreviewWrapperRef: coverRef,
  })

  return (
    <>
      {previewImgProps &&
        createPortal(
          <PreviewImage
            {...previewImgProps}
            data-bili-gate-search-overlay='snapshot'
            style={{ borderRadius: 'inherit' }}
          />,
          overlayHost,
        )}
      {videoPreview.addTo.searchPage && (
        <SearchFloatingPreview
          key={snapshotEnabled ? 'button' : 'card'}
          info={info}
          card={card}
          overlayHost={overlayHost}
          uniqId={uniqId}
          buttonOnly={snapshotEnabled}
          onVisibilityChange={setFloatingVisible}
        />
      )}
    </>
  )
}

function SearchFloatingPreview({
  info,
  card,
  overlayHost,
  uniqId,
  buttonOnly,
  onVisibilityChange,
}: {
  info: SearchCardInfo
  card: HTMLElement
  overlayHost: HTMLElement
  uniqId: string
  buttonOnly: boolean
  onVisibilityChange: (visible: boolean) => void
}) {
  const coverRef = useRef<HTMLElement | null>(info.link)
  const hovering = useHover(coverRef)
  const [cid, setCid] = useState<number>()
  const canPreview = info.page === 1 || cid !== undefined
  useEffect(() => {
    if (canPreview || !hovering) return
    let cancelled = false
    void getVideoPageList(info.bvid)
      .then((pages) => {
        if (!cancelled) setCid(pages.find((page) => page.page === info.page)?.cid)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [canPreview, hovering, info])
  const { largePreviewActionButtonEl, largePreviewEl, largePreviewVisible } = useLargePreviewRelated({
    shouldFetchPreviewData: canPreview,
    hasLargePreviewActionButton: true,
    actionButtonVisible: hovering,
    bvid: info.bvid,
    cid,
    uniqId,
    recSharedEmitter: defaultRecSharedEmitter,
    cardTarget: card,
    cover: info.cover,
    videoTitle: info.title,
    // A hover scrubs snapshots. The existing button still opens the floating player.
    videoCardAsTriggerRef: buttonOnly || !canPreview ? undefined : coverRef,
  })
  useEffect(() => {
    onVisibilityChange(largePreviewVisible)
    return () => onVisibilityChange(false)
  }, [largePreviewVisible, onVisibilityChange])
  return (
    <>
      {createPortal(
        <div
          data-bili-gate-search-overlay='button'
          className='pointer-events-auto absolute right-[calc(8px+28px+5px)] top-8px z-6'
        >
          {largePreviewActionButtonEl}
        </div>,
        overlayHost,
      )}
      {largePreviewEl}
    </>
  )
}
