import { describe, expect, it } from 'vitest'
import { getPreviewImageFrame } from './preview-image'

describe('getPreviewImageFrame', () => {
  // Two 3 × 2 sprite sheets, sampled every 10 seconds.
  const timestamps = Array.from({ length: 12 }, (_, index) => index * 10)

  it.each([
    ['first frame', 0, { imageIndex: 0, rowIndex: 0, columnIndex: 0 }],
    ['last column', 20, { imageIndex: 0, rowIndex: 0, columnIndex: 2 }],
    ['next row', 30, { imageIndex: 0, rowIndex: 1, columnIndex: 0 }],
    ['last frame of a sheet', 50, { imageIndex: 0, rowIndex: 1, columnIndex: 2 }],
    ['next sheet', 60, { imageIndex: 1, rowIndex: 0, columnIndex: 0 }],
    ['between samples', 65, { imageIndex: 1, rowIndex: 0, columnIndex: 0 }],
    ['last timestamp', 110, { imageIndex: 1, rowIndex: 1, columnIndex: 2 }],
    ['past the last timestamp', 120, { imageIndex: 1, rowIndex: 1, columnIndex: 2 }],
  ] as const)('%s', (_, t, expected) => {
    expect(getPreviewImageFrame(timestamps, t, 3, 2)).toEqual(expected)
  })

  it('uses the first snapshot before the first timestamp', () => {
    expect(getPreviewImageFrame([5, 15, 25], 0, 3, 2)).toEqual({
      imageIndex: 0,
      rowIndex: 0,
      columnIndex: 0,
    })
  })

  it('ignores missing or invalid sprite data', () => {
    expect(getPreviewImageFrame([], 0, 3, 2)).toBeUndefined()
    expect(getPreviewImageFrame(timestamps, 0, 0, 2)).toBeUndefined()
    expect(getPreviewImageFrame(timestamps, 0, 3, 0)).toBeUndefined()
    expect(getPreviewImageFrame(timestamps, NaN, 3, 2)).toBeUndefined()
  })
})
