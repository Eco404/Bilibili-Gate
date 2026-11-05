import { useEventListener, useMemoizedFn, useRafState, useUnmount, useUnmountedRef } from 'ahooks'
import { delay } from 'es-toolkit'
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from 'react'
import { __PROD__, appLog, appWarn } from '$common'
import { useEmitterOn } from '$common/hooks/useEmitter'
import { useRefBox, useRefStateBox, type RefBox, type RefStateBox } from '$common/hooks/useRefState'
import { settings } from '$modules/settings'
import { minmax } from '$utility/num'
import { PreviewImage, type PreviewImageRef } from '../child-components/PreviewImage'
import type { RecSharedEmitter } from '$components/Recommends/rec.shared'
import type { ImagePreviewData } from '../services'

const DEBUG_ANIMATION = __PROD__
  ? false //
  : false // 👈🏻👈🏻👈🏻 dev: free to change
function debugAnimation(...args: Parameters<typeof appLog>) {
  if (!DEBUG_ANIMATION) return
  const [message, ...rest] = args
  appLog(`[animation] ${message}`, ...rest)
}

/**
 * 自动以动画方式预览
 */
export function usePreviewRelated({
  enabled = true,
  uniqId,
  recSharedEmitter,
  title,
  active,
  videoDuration,
  tryFetchImagePreviewData,
  imagePreviewDataBox,
  autoPreviewWhenHover,
  videoPreviewWrapperRef,
}: {
  enabled?: boolean
  uniqId: string
  recSharedEmitter: RecSharedEmitter
  title: string
  active: boolean
  videoDuration?: number
  tryFetchImagePreviewData: () => Promise<void>
  imagePreviewDataBox: RefStateBox<ImagePreviewData | undefined>
  autoPreviewWhenHover: boolean
  videoPreviewWrapperRef: RefObject<HTMLElement | null>
}) {
  const unmounted = useUnmountedRef()
  const requestGeneration = useRef(0)
  const isCurrentRequest = useMemoizedFn(
    (generation: number) => enabled && !unmounted.current && generation === requestGeneration.current,
  )
  const hasVideoData = useMemoizedFn(() => {
    const data = imagePreviewDataBox.val?.videoshotJson?.data
    return Boolean(data?.index?.length && data?.image?.length)
  })
  const pendingFetch = useRef<{ uniqId: string; promise: Promise<void> } | undefined>(undefined)
  const fetchPreviewData = useMemoizedFn(() => {
    if (pendingFetch.current?.uniqId === uniqId) return pendingFetch.current.promise

    // A new hover must await the original request, even if the caller uses useLockFn.
    const promise = Promise.resolve()
      .then(tryFetchImagePreviewData)
      .finally(() => {
        if (pendingFetch.current?.promise === promise) pendingFetch.current = undefined
      })
    pendingFetch.current = { uniqId, promise }
    return promise
  })

  const [autoPreviewing, setAutoPreviewing] = useState(false)
  const [previewProgress, setPreviewProgress] = useRafState<number | undefined>()
  const [previewT, setPreviewT] = useRafState<number | undefined>()
  const getProgress = useMemoizedFn(() => previewProgress || 0)
  const getVideoDuration = useMemoizedFn(() => videoDuration)

  const [mouseMoved, setMouseMoved] = useState(false)

  // 在 pvideodata 加载的时候, useHover 会有变化, so 使用 mouseenter/mouseleave 自己处理
  const isHoveringBox = useRefStateBox(false)
  const isHoveringAfterDelayBox = useRefStateBox(false)
  const startByHoverBox = useRefBox(false)

  // mouseenter cursor state
  const [mouseProgress, setMouseProgress] = useState<number | undefined>(undefined)
  const updateMouseProgress = (e: MouseEvent) => {
    const rect = videoPreviewWrapperRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    // https://github.com/alibaba/hooks/blob/v3.7.0/packages/hooks/src/useMouse/index.ts#L62
    const { x, width } = rect
    const relativeX = e.pageX - window.scrollX - x
    setMouseProgress(minmax(relativeX / width, 0, 1))
  }

  const startHoverPreview = useMemoizedFn(async () => {
    const generation = ++requestGeneration.current
    if (!enabled || unmounted.current || !isHoveringBox.val) return

    isHoveringAfterDelayBox.set(false)
    try {
      // Fetch and hover delay run together, so a slow request adds no extra delay.
      await Promise.all([fetchPreviewData(), settings.useDelayForHover ? delay(800) : undefined])
    } catch (error) {
      if (isCurrentRequest(generation)) appWarn('image preview request failed: %o', error)
      return
    }

    if (!isCurrentRequest(generation) || !isHoveringBox.val) return
    isHoveringAfterDelayBox.set(true)

    if (autoPreviewWhenHover && idBox.val === undefined && hasVideoData()) {
      debugAnimation(`mouseenter onStartPreviewAnimation uniqId=%s title=%s`, uniqId, title)
      onStartPreviewAnimation(true)
    }
  })

  useEventListener(
    'mouseenter',
    (e) => {
      recSharedEmitter.emit('mouseenter', uniqId)

      isHoveringBox.set(true)
      updateMouseProgress(e)

      void startHoverPreview()
    },
    { target: videoPreviewWrapperRef },
  )

  // mouseleave
  const _mouseleaveAction = useMemoizedFn(() => {
    requestGeneration.current++
    isHoveringBox.set(false)
    isHoveringAfterDelayBox.set(false)
    if (startByHoverBox.val) animationController.stop()
  })
  useEventListener('mouseleave', _mouseleaveAction, { target: videoPreviewWrapperRef })
  useEmitterOn(recSharedEmitter, 'mouseenter', ({ data: srcUniqId }) => {
    if (srcUniqId === uniqId) return
    _mouseleaveAction()
  })

  useEventListener(
    'mousemove',
    (e: MouseEvent) => {
      setMouseMoved(true)

      // update mouse enter state in mouseenter-delay
      if (isHoveringBox.val && (!isHoveringAfterDelayBox.val || !autoPreviewWhenHover)) {
        updateMouseProgress(e)
      }

      if (!autoPreviewWhenHover) {
        animationController.stop()
      }
    },
    { target: videoPreviewWrapperRef },
  )

  // raf id
  const idBox = useRefBox<number | undefined>(undefined)

  const onResume = useRef<(() => void) | undefined>(undefined)

  const animationController = useAnimationController({
    enabled,
    startByHoverBox,
    isHoveringBox,
    active,
    mouseMoved,
    idBox,
    autoPreviewWhenHover,
    setAutoPreviewing,
    setPreviewT,
    setPreviewProgress,
    onResume() {
      onResume.current?.()
    },
  })

  const onHotkeyPreviewAnimation = useMemoizedFn(async () => {
    if (!enabled || unmounted.current || !active) return
    // console.log('hotkey preview', animationPaused)
    if (idBox.val === undefined) {
      const generation = ++requestGeneration.current
      try {
        await fetchPreviewData()
      } catch (error) {
        if (isCurrentRequest(generation)) appWarn('image preview request failed: %o', error)
        return
      }
      if (isCurrentRequest(generation) && hasVideoData()) {
        onStartPreviewAnimation(false)
      }
      return
    }

    // toggle
    animationController.togglePaused()
  })

  const onStartPreviewAnimation = useMemoizedFn((startByHover: boolean) => {
    if (!enabled || unmounted.current || !hasVideoData()) return
    if (startByHover ? !isHoveringBox.val : !active) return
    startByHoverBox.set(startByHover)
    setMouseMoved(false)
    animationController.reset()
    animationController.stop(true) // clear existing

    setAutoPreviewing(true)
    setPreviewProgress((val) => (val === undefined ? 0 : val)) // get rid of undefined
    setPreviewT(undefined)

    const RUN_DURATION = 8000 // total ms
    let start = performance.now()
    let updateAt = 0

    // resume()'s implementation
    onResume.current = () => {
      start = performance.now() - getProgress() * RUN_DURATION
    }

    function frame(t: number) {
      // stop
      if (animationController.shouldStop()) {
        return animationController.stop()
      }

      if (!animationController.paused) {
        const now = performance.now()
        const elapsed = now - start
        const p = minmax((elapsed % RUN_DURATION) / RUN_DURATION, 0, 1)

        setPreviewProgress(p)

        if (!updateAt || now - updateAt >= settings.autoPreviewUpdateInterval) {
          setPreviewProgress(p)

          updateAt = now
          const duration = getVideoDuration()
          if (duration) {
            const t = minmax(Math.round(p * duration), 0, duration)
            setPreviewT(t)
          }
        }
      }

      idBox.val = requestAnimationFrame(frame)
    }

    idBox.val = requestAnimationFrame(frame)
  })

  const stopAnimation = animationController.stop
  useEffect(() => {
    requestGeneration.current++
    isHoveringAfterDelayBox.set(false)
    stopAnimation()
    if (enabled && isHoveringBox.val) void startHoverPreview()

    return () => {
      requestGeneration.current++
    }
  }, [enabled, autoPreviewWhenHover, uniqId, isHoveringBox, isHoveringAfterDelayBox, stopAnimation, startHoverPreview])

  useUnmount(() => {
    requestGeneration.current++
    if (idBox.val !== undefined) cancelAnimationFrame(idBox.val)
    idBox.val = undefined
    onResume.current = undefined
  })

  const isHovering = isHoveringBox.state
  const isHoveringAfterDelay = isHoveringAfterDelayBox.state

  const videoshotData = imagePreviewDataBox.state?.videoshotJson?.data
  const shouldShowPreview =
    enabled &&
    !!videoshotData?.image?.length &&
    !!videoDuration &&
    (isHoveringAfterDelay || active) &&
    (autoPreviewWhenHover ? autoPreviewing : true)

  const previewImageRef = useRef<PreviewImageRef>(null) // to expose imperative `getT()`
  let previewImgProps: ComponentProps<typeof PreviewImage> | undefined
  let previewImageEl: ReactNode
  if (shouldShowPreview) {
    const sharedProps = {
      videoDuration,
      pvideo: videoshotData,
    }
    if (autoPreviewWhenHover) {
      // auto-preview: start-by (hover | keyboard)
      previewImgProps = { ...sharedProps, progress: previewProgress, t: previewT }
    } else {
      // follow-mouse
      previewImgProps = { ...sharedProps, progress: mouseProgress }
    }
    previewImageEl = <PreviewImage ref={previewImageRef} {...previewImgProps} />
  }

  return {
    onHotkeyPreviewAnimation,
    onStartPreviewAnimation,
    autoPreviewing,
    mouseProgress,
    previewProgress,
    previewT,
    //
    isHovering,
    isHoveringAfterDelay,
    // el
    shouldShowPreview,
    previewImageRef,
    previewImgProps,
    previewImageEl,
  }
}

function useAnimationController({
  enabled,
  startByHoverBox,
  isHoveringBox,
  idBox,
  active,
  mouseMoved,
  autoPreviewWhenHover,
  setAutoPreviewing,
  setPreviewT,
  setPreviewProgress,
  onResume,
}: {
  enabled: boolean
  startByHoverBox: RefBox<boolean>
  isHoveringBox: RefStateBox<boolean>
  idBox: RefBox<number | undefined>
  active: boolean
  mouseMoved: boolean
  autoPreviewWhenHover: boolean
  setAutoPreviewing: (autoPreviewing: boolean) => void
  setPreviewT: (t: number | undefined) => void
  setPreviewProgress: (p: number | undefined) => void
  onResume?: () => void
}) {
  const unmounted = useUnmountedRef()

  // 停止动画
  //  - 鼠标动了
  //  - 不再 active
  //  - 组件卸载了
  const shouldStop = useMemoizedFn(() => {
    if (!enabled || unmounted.current) return true

    // mouse
    if (startByHoverBox.val) {
      if (!isHoveringBox.val) return true
    }
    // normal keyboard control
    else {
      if (!active) return true
      if (mouseMoved) return true
    }

    return false
  })

  const stop = useMemoizedFn((isClear = false) => {
    if (!isClear) {
      debugAnimation(`stopAnimation: %o`, {
        autoPreviewWhenHover,
        unmounted: unmounted.current,
        isHovering: isHoveringBox.val,
        active,
        mouseMoved,
      })
    }

    if (idBox.val !== undefined) cancelAnimationFrame(idBox.val)
    idBox.val = undefined
    if (unmounted.current) return
    setAutoPreviewing(false)
    setPreviewProgress(undefined)
    setPreviewT(undefined)
    controller.reset()
  })

  const _paused = useRef(false)

  const controller = useMemo(() => {
    return {
      shouldStop,
      stop,

      get paused() {
        return _paused.current
      },
      set paused(val: boolean) {
        _paused.current = val
      },

      togglePaused() {
        const prev = this.paused
        this.paused = !this.paused
        if (prev) {
          // to resume
          onResume?.()
        } else {
          // to pause
        }
      },

      reset() {
        this.paused = false
      },
    }
  }, [shouldStop, stop, _paused, onResume])

  return controller
}
