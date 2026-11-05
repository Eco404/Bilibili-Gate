/** Select the latest snapshot at or before t, keeping all sprite coordinates zero-based. */
export function getPreviewImageFrame(timestamps: readonly number[], t: number, colCount: number, rowCount: number) {
  if (
    !timestamps.length ||
    !Number.isFinite(t) ||
    !Number.isInteger(colCount) ||
    !Number.isInteger(rowCount) ||
    colCount <= 0 ||
    rowCount <= 0
  ) {
    return
  }

  let left = 0
  let right = timestamps.length - 1
  let frameIndex = 0
  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    if (timestamps[mid] <= t) {
      frameIndex = mid
      left = mid + 1
    } else {
      right = mid - 1
    }
  }

  const framesPerImage = colCount * rowCount
  const indexInImage = frameIndex % framesPerImage
  return {
    imageIndex: Math.floor(frameIndex / framesPerImage),
    rowIndex: Math.floor(indexInImage / colCount),
    columnIndex: indexInImage % colCount,
  }
}
