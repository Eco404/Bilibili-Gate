import { useMemoizedFn, useSize } from 'ahooks'
import clsx from 'clsx'
import {
  memo,
  useImperativeHandle,
  useMemo,
  useRef,
  type ComponentProps,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type Ref,
} from 'react'
import { minmax } from '$utility/num'
import { clsZPreviewImageWrapper } from '../index.shared'
import { getPreviewImageFrame } from './preview-image'
import type { PvideoData } from '$define'

/**
 * 关于 `pointer-events: none`
 * see https://github.com/magicdawn/Bilibili-Gate/issues/112
 * useMouse 使用的是 document.addEventListener, 不用它响应 mousemove 事件
 */
const clsPreviewImageWrapper = clsx(
  'pointer-events-none absolute inset-0 overflow-hidden',
  clsZPreviewImageWrapper,
  'rounded-b-none rounded-t-gate-video-card', // 配合进度条, 底部不需要圆角
)

/**
 * previewProgress 代表进度条进度
 * previewT 代表将渲染的图片
 * 两个解耦, previewT 可以 fallback 到 `previewProgress * videoDuration`
 */
interface IProps extends ComponentPropsWithoutRef<'div'> {
  videoDuration: number
  pvideo?: PvideoData
  progress?: number
  t?: number
  ref?: Ref<PreviewImageRef>
}

export type PreviewImageRef = {
  getT: () => number | undefined
}

export const PreviewImage = memo(function PreviewImage({
  videoDuration,
  pvideo,
  progress,
  t,
  className,
  ref,
  ...restProps
}: IProps) {
  const rootElRef = useRef<ComponentRef<'div'>>(null)
  const size = useSize(rootElRef) ?? { width: 0, height: 0 }

  const usingProgress = useMemo(() => {
    function getProgress(): number | undefined {
      if (typeof progress === 'number' && !Number.isNaN(progress)) return progress
      return 0
    }
    return minmax(getProgress() ?? 0, 0, 1)
  }, [progress])

  const usingT = useMemo(() => t ?? Math.floor((videoDuration || 0) * usingProgress), [t, videoDuration, usingProgress])

  /**
   * expose ref as imperative handle
   * 使用 pvideo.index 获取也不是很准确, 缩略图与视频有几秒偏差~
   */
  const getT = useMemoizedFn(() => usingT)
  useImperativeHandle(ref, () => ({ getT }), [getT])

  const innerProps = {
    progress: usingProgress,
    t: usingT,
    pvideo: pvideo!,
    elWidth: size.width,
    elHeight: size.height,
  }

  return (
    <div {...restProps} ref={rootElRef} className={clsx(clsPreviewImageWrapper, className)}>
      {!!(pvideo && size.width && size.height) && <PreviewImageInner {...innerProps} />}
    </div>
  )
})

const PreviewImageInner = memo(function PreviewImageInner({
  t,
  progress,
  pvideo,
  elWidth,
  elHeight,
}: {
  t: number
  progress: number
  pvideo: PvideoData
  elWidth: number
  elHeight: number
}) {
  const { img_x_len: colCount, img_y_len: rowCount } = pvideo
  const frame = useMemo(
    () => getPreviewImageFrame(pvideo.index || [], t, colCount, rowCount),
    [pvideo, t, colCount, rowCount],
  )
  const snapshotUrl = frame && pvideo.image?.[frame.imageIndex]
  if (!frame || !snapshotUrl) return null

  // 缩放比例:
  // 从原始图片(rawWidth * rawHeight) 的 (startX, startY)点 中抠出 w*h
  // 缩放到 elementW * elementH, 放入 background 中
  // see https://stackoverflow.com/questions/50301190/how-to-scale-css-sprites-when-used-as-background-image

  const newImgWidth = elWidth * colCount
  const newImgHeight = elHeight * rowCount

  const startY = frame.rowIndex * elHeight
  const startX = frame.columnIndex * elWidth

  return (
    <div
      className='size-full'
      style={{
        backgroundColor: 'black', // 防止加载过程中闪屏
        backgroundImage: `url(${snapshotUrl})`,
        backgroundPosition: `-${startX}px -${startY}px`,
        backgroundSize: `${newImgWidth}px ${newImgHeight}px`,
      }}
    >
      <SimpleProgressBar progress={progress} />
    </div>
  )
})

export function SimpleProgressBar({ progress, className, ...props }: { progress: number } & ComponentProps<'div'>) {
  return (
    <div {...props} data-role='track' className={clsx('absolute inset-x-0 bottom-0 h-2px bg-gate-bg-lv1', className)}>
      <div data-role='bar' className='h-full bg-gate-primary' style={{ width: `${progress * 100}%` }} />
    </div>
  )
}
