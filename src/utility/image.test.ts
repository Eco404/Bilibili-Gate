import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { preloadImg } from './image'

vi.mock('$ua', () => ({ isSafari: true }))

describe('preloadImg', () => {
  const createdImage = vi.fn()

  beforeEach(() => {
    createdImage.mockClear()
    vi.stubGlobal(
      'Image',
      class {
        onload?: () => void
        onerror?: () => void

        constructor() {
          createdImage()
        }

        set src(value: string) {
          if (value === 'invalid') this.onerror?.()
          else this.onload?.()
        }
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('registers handlers before setting the source, even for immediately available images', async () => {
    expect(await preloadImg('https://example.com/snapshot.jpg')).toBe(true)
    expect(await preloadImg('invalid')).toBe(false)
  })

  it('returns without creating an image when the source is empty', async () => {
    expect(await preloadImg('')).toBe(false)
    expect(createdImage).not.toHaveBeenCalled()
  })
})
