import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PvideoJson } from '$define'

const { requestGet, preloadImg, imgPreviewSettings } = vi.hoisted(() => ({
  requestGet: vi.fn(),
  preloadImg: vi.fn(),
  imgPreviewSettings: { autoPreviewWhenHover: true },
}))

vi.mock('$common', () => ({ appWarn: vi.fn() }))
vi.mock('$request', () => ({
  request: { get: requestGet },
  isWebApiSuccess: (json: { code: number }) => json.code === 0,
}))
vi.mock('$modules/settings', () => ({ settings: { videoCard: { imgPreview: imgPreviewSettings } } }))
vi.mock('$utility/image', () => ({ preloadImg }))

function videoshot(image = 'https://example.com/snapshot.jpg'): PvideoJson {
  return {
    code: 0,
    message: '0',
    ttl: 1,
    data: {
      pvdata: '',
      img_x_len: 10,
      img_y_len: 10,
      img_x_size: 160,
      img_y_size: 90,
      image: [image],
      index: [0, 10, 20],
    },
  }
}

describe('videoshot requests', () => {
  beforeEach(() => {
    vi.resetModules()
    requestGet.mockReset()
    preloadImg.mockReset().mockResolvedValue(true)
    imgPreviewSettings.autoPreviewWhenHover = true
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps each CID and the default page in separate caches', async () => {
    const first = videoshot('https://example.com/first.jpg')
    const second = videoshot('https://example.com/second.jpg')
    const defaultPage = videoshot('https://example.com/default.jpg')
    requestGet
      .mockResolvedValueOnce({ data: first })
      .mockResolvedValueOnce({ data: second })
      .mockResolvedValueOnce({ data: defaultPage })
    const { getVideoshotJson } = await import('./videoshot')

    expect(await getVideoshotJson('BV1test', 101)).toBe(first)
    expect(await getVideoshotJson('BV1test', 202)).toBe(second)
    expect(await getVideoshotJson('BV1test')).toBe(defaultPage)
    expect(await getVideoshotJson('BV1test', 101)).toBe(first)
    expect(await getVideoshotJson('BV1test', 202)).toBe(second)
    expect(await getVideoshotJson('BV1test')).toBe(defaultPage)

    expect(requestGet).toHaveBeenCalledTimes(3)
    expect(requestGet).toHaveBeenNthCalledWith(1, '/x/player/videoshot', {
      params: { bvid: 'BV1test', cid: 101, index: '1' },
    })
    expect(requestGet).toHaveBeenNthCalledWith(2, '/x/player/videoshot', {
      params: { bvid: 'BV1test', cid: 202, index: '1' },
    })
    expect(requestGet).toHaveBeenNthCalledWith(3, '/x/player/videoshot', {
      params: { bvid: 'BV1test', cid: undefined, index: '1' },
    })
  })

  it('shares pending requests only for the same video and CID', async () => {
    const json = videoshot()
    const { promise, resolve: completeRequest } = Promise.withResolvers<{ data: PvideoJson }>()
    requestGet.mockReturnValue(promise)
    const { getVideoshotJson } = await import('./videoshot')

    const results = [
      getVideoshotJson('BV1test', 101),
      getVideoshotJson('BV1test', 101),
      getVideoshotJson('BV1test', 202),
    ]
    await vi.waitFor(() => expect(requestGet).toHaveBeenCalledTimes(2))
    completeRequest({ data: json })
    expect(await Promise.all(results)).toEqual([json, json, json])
  })

  it('returns unavailable snapshots without attempting to preload an absent image', async () => {
    const json = { code: -404, message: '视频不存在', ttl: 1 }
    requestGet.mockResolvedValue({ data: json })
    const { getVideoshotJson } = await import('./videoshot')

    expect(await getVideoshotJson('BV1missing', 101)).toBe(json)
    expect(preloadImg).not.toHaveBeenCalled()
    expect(await getVideoshotJson('BV1missing', 101)).toBe(json)
    expect(requestGet).toHaveBeenCalledTimes(1)
  })

  it('retries incomplete success responses and leaves them uncached', async () => {
    vi.useFakeTimers()
    const json = videoshot()
    json.data.image = []
    requestGet.mockResolvedValue({ data: json })
    const { getVideoshotJson } = await import('./videoshot')

    const first = getVideoshotJson('BV1empty', 101)
    await vi.runAllTimersAsync()
    expect(await first).toBe(json)
    expect(requestGet).toHaveBeenCalledTimes(5)
    expect(preloadImg).not.toHaveBeenCalled()

    const retry = getVideoshotJson('BV1empty', 101)
    await vi.runAllTimersAsync()
    expect(await retry).toBe(json)
    expect(requestGet).toHaveBeenCalledTimes(10)
  })
})
